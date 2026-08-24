import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate, NavLink } from "react-router-dom";
import { toast } from "react-toastify";
import "./AdminDeliveries.css";

const BASE_URL = process.env.REACT_APP_API_URL || "https://final-project1-d3iz.onrender.com";

const adminFetch = async (path, opts = {}) => {
  const token = localStorage.getItem("jwtToken");
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Request failed");
  return json;
};

const CARRIERS = ['BlueDart', 'Delhivery Express', 'DHL Express', 'FedEx'];

const AdminDeliveries = () => {
  const navigate = useNavigate();
  const currentUser = useSelector((s) => s.users.currentUser);

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState(null);
  
  // Modal Edit Form States
  const [carrier, setCarrier] = useState("");
  const [trackingId, setTrackingId] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState("");
  const [saving, setSaving] = useState(false);

  // Delhivery Pincode lookup state
  const [lookupPincode, setLookupPincode] = useState("");
  const [checkingPincode, setCheckingPincode] = useState(false);
  const [pincodeResult, setPincodeResult] = useState(null);

  // AI Delivery Copilot states
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiDeliveryData, setAiDeliveryData] = useState(null);
  const [deliveryQuery, setDeliveryQuery] = useState("");
  const [deliveryAnswering, setDeliveryAnswering] = useState(false);
  const [deliveryAnswer, setDeliveryAnswer] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useState(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!currentUser) {
      navigate("/");
    }
  }, [currentUser, navigate]);

  const fetchAllOrders = async () => {
    setLoading(true);
    try {
      const data = await adminFetch("/api/payment/orders");
      if (data.success) {
        setOrders(data.orders);
      }
    } catch (err) {
      toast.error(err.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchAllOrders();
    }
  }, [currentUser]);

  // Generate a random tracking ID based on selected carrier
  const handleAutoGenerateTracking = () => {
    const activeCarrier = carrier || CARRIERS[Math.floor(Math.random() * CARRIERS.length)];
    if (!carrier) setCarrier(activeCarrier);
    const prefix = activeCarrier.substring(0, 3).toUpperCase();
    const num = Math.floor(10000000 + Math.random() * 90000000);
    setTrackingId(`NIX-${prefix}-${num}-IN`);
    toast.info(`Smart tracking ID generated for ${activeCarrier}!`);
  };

  // Open the dispatch manager modal
  const openManageModal = (order) => {
    setSelectedOrder(order);
    setCarrier(order.carrier || CARRIERS[0]);
    setTrackingId(order.trackingId || "");
    setShippingAddress(order.shippingAddress || "");
    setDeliveryStatus(order.deliveryStatus || "Confirmed");
    setLookupPincode("");
    setPincodeResult(null);
  };

  const handleCheckPincode = async () => {
    if (!lookupPincode || lookupPincode.length !== 6) {
      toast.error("Please enter a valid 6-digit Pincode.");
      return;
    }
    setCheckingPincode(true);
    setPincodeResult(null);
    try {
      const res = await adminFetch(`/api/payment/delhivery/pincode/${lookupPincode}`);
      if (res.success && res.data && res.data.centers && res.data.centers.length > 0) {
        const center = res.data.centers[0];
        setPincodeResult({
          success: true,
          serviceable: center.is_active || center.is_serviceable || true,
          region: center.center_name,
          district: center.district,
          state: center.state_code
        });
      } else {
        setPincodeResult({
          success: true,
          serviceable: false
        });
      }
    } catch (err) {
      setPincodeResult({
        success: false,
        message: "Failed to check serviceability (verify API token)."
      });
    } finally {
      setCheckingPincode(false);
    }
  };

  // ── Voice & Text "Ask Delivery AI" ─────────────────
  const toggleVoiceSearch = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.info("Voice recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-IN";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        setDeliveryQuery(transcript);
        handleAskDeliveryAi(transcript);
      };

      recognition.start();
    } catch (e) {
      setIsListening(false);
    }
  };

  const handleAskDeliveryAi = async (customQuery) => {
    const q = (customQuery || deliveryQuery).trim();
    if (!q) return;

    setDeliveryAnswering(true);
    setDeliveryAnswer("");
    try {
      const res = await adminFetch("/api/payment/ai-delivery-ask", {
        method: "POST",
        body: JSON.stringify({ query: q }),
      });
      if (res.success) {
        setDeliveryAnswer(res.answer);
      } else {
        toast.error(`Delivery AI error: ${res.message}`);
      }
    } catch (err) {
      toast.error(`Delivery AI error: ${err.message}`);
    } finally {
      setDeliveryAnswering(false);
    }
  };

  // ── AI Order & Address Analysis ────────────────────
  const runAiDeliveryAnalysis = async () => {
    if (!shippingAddress.trim()) {
      toast.error("Please enter or select a shipping address first.");
      return;
    }

    setAiAnalyzing(true);
    try {
      const res = await adminFetch("/api/payment/ai-delivery-analyze", {
        method: "POST",
        body: JSON.stringify({
          shippingAddress,
          pincode: lookupPincode,
          carrier,
          trackingId,
          customerName: selectedOrder?.email?.split("@")[0] || "Customer",
          customerPhone: selectedOrder?.phone || "",
          orderId: selectedOrder?._id ? String(selectedOrder._id).slice(-6) : "",
          totalAmount: selectedOrder?.totalAmount || 0,
          items: selectedOrder?.items || [],
        }),
      });

      if (res.success && res.data) {
        setAiDeliveryData(res.data);
        if (res.data.pincode && !lookupPincode) {
          setLookupPincode(res.data.pincode);
        }
        toast.success("✨ AI Delivery analysis complete!");
      } else {
        toast.error(`AI analysis failed: ${res.message}`);
      }
    } catch (err) {
      toast.error(`AI analysis error: ${err.message}`);
    } finally {
      setAiAnalyzing(false);
    }
  };

  const applyCleanedAddress = () => {
    if (aiDeliveryData?.cleanedAddress) {
      setShippingAddress(aiDeliveryData.cleanedAddress);
      toast.success("✅ Cleaned address applied!");
    }
  };

  const applyRecommendedCarrier = () => {
    if (aiDeliveryData?.recommendedCarrier) {
      setCarrier(aiDeliveryData.recommendedCarrier);
      toast.success(`🚚 Selected ${aiDeliveryData.recommendedCarrier}!`);
    }
  };

  const openWhatsAppDispatch = () => {
    if (!aiDeliveryData?.whatsAppMessage) {
      toast.info("Run AI analysis first to generate WhatsApp message.");
      return;
    }
    const phone = selectedOrder?.phone || "";
    const cleanPhone = phone.replace(/[^\d]/g, "");
    const encoded = encodeURIComponent(aiDeliveryData.whatsAppMessage);
    const url = cleanPhone ? `https://wa.me/91${cleanPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, "_blank");
  };

  // Submit the delivery updates
  const handleSaveDelivery = async (e) => {
    e.preventDefault();
    if (!selectedOrder) return;
    
    setSaving(true);
    try {
      const data = await adminFetch(`/api/payment/orders/${selectedOrder._id}/delivery`, {
        method: "PATCH",
        body: JSON.stringify({
          carrier,
          trackingId,
          shippingAddress,
          deliveryStatus
        })
      });

      if (data.success) {
        toast.success("Delivery details successfully updated!");
        // Update local list
        setOrders(prev => prev.map(o => o._id === selectedOrder._id ? data.order : o));
        setSelectedOrder(null);
      } else {
        toast.error(data.message || "Failed to update shipment");
      }
    } catch (err) {
      toast.error(err.message || "Network error while saving");
    } finally {
      setSaving(false);
    }
  };

  // Derived filter calculations
  const filteredOrders = orders.filter(o => {
    const query = search.toLowerCase();
    const matchSearch = 
      o.razorpayOrderId?.toLowerCase().includes(query) ||
      o.email?.toLowerCase().includes(query) ||
      o.trackingId?.toLowerCase().includes(query) ||
      o.razorpayPaymentId?.toLowerCase().includes(query);
      
    const matchStatus = statusFilter === "all" || o.deliveryStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  // KPI Calculations
  const kpiTotal = orders.length;
  const kpiPending = orders.filter(o => o.deliveryStatus === "Confirmed" || o.deliveryStatus === "Processing").length;
  const kpiTransit = orders.filter(o => o.deliveryStatus === "Shipped" || o.deliveryStatus === "In Transit" || o.deliveryStatus === "Out for Delivery").length;
  const kpiDelivered = orders.filter(o => o.deliveryStatus === "Delivered").length;

  const getBadgeClass = (status) => {
    switch (status) {
      case "Delivered": return "badge-delivered";
      case "Out for Delivery": return "badge-outfordel";
      case "In Transit": return "badge-transit";
      case "Shipped": return "badge-shipped";
      case "Processing": return "badge-processing";
      default: return "badge-confirmed";
    }
  };

  if (!currentUser) return null;

  return (
    <section className="ad-page">
      <div className="container-fluid px-4 py-4">

        {/* ── Admin Nav Tabs ── */}
        <div className="ad-nav-tabs mb-4">
          <NavLink to="/admin/users" className={({ isActive }) => `ad-nav-tab${isActive ? " active" : ""}`}>👥 Users</NavLink>
          <NavLink to="/admin/products" className={({ isActive }) => `ad-nav-tab${isActive ? " active" : ""}`}>🛍️ Products</NavLink>
          <NavLink to="/admin/categories" className={({ isActive }) => `ad-nav-tab${isActive ? " active" : ""}`}>🗂️ Categories</NavLink>
          <NavLink to="/admin/bills" className={({ isActive }) => `ad-nav-tab${isActive ? " active" : ""}`}>🧾 Bills</NavLink>
          <NavLink to="/admin/customers" className={({ isActive }) => `ad-nav-tab${isActive ? " active" : ""}`}>👤 Customers</NavLink>
          <NavLink to="/admin/stock" className={({ isActive }) => `ad-nav-tab${isActive ? " active" : ""}`}>📦 Stock</NavLink>
          <NavLink to="/admin/discounts" className={({ isActive }) => `ad-nav-tab${isActive ? " active" : ""}`}>🏷️ Discounts</NavLink>
          <NavLink to="/admin/deliveries" className={({ isActive }) => `ad-nav-tab${isActive ? " active" : ""}`}>🚚 Deliveries</NavLink>
        </div>

        {/* ── Page Header ── */}
        <div className="ad-header d-flex justify-content-between align-items-center mb-4">
          <div>
            <h2 className="ad-title">Delivery &amp; Shipment Operations</h2>
            <p className="ad-sub">{orders.length} successful online orders synced from payment gateway</p>
          </div>
          <button className="ad-refresh-btn" onClick={fetchAllOrders} disabled={loading}>
            🔄 Refresh Sync
          </button>
        </div>

        {/* ── Dashboard KPIs ── */}
        <div className="ad-kpis mb-4">
          <div className="ad-kpi-card">
            <div className="ad-kpi-icon icon-total">📦</div>
            <div>
              <div className="ad-kpi-num">{kpiTotal}</div>
              <div className="ad-kpi-lbl">Total synced orders</div>
            </div>
          </div>
          <div className="ad-kpi-card">
            <div className="ad-kpi-icon icon-pending">⏳</div>
            <div>
              <div className="ad-kpi-num">{kpiPending}</div>
              <div className="ad-kpi-lbl">Awaiting Shipment</div>
            </div>
          </div>
          <div className="ad-kpi-card">
            <div className="ad-kpi-icon icon-transit">🚚</div>
            <div>
              <div className="ad-kpi-num">{kpiTransit}</div>
              <div className="ad-kpi-lbl">In Transit / Active</div>
            </div>
          </div>
          <div className="ad-kpi-card">
            <div className="ad-kpi-icon icon-success">✅</div>
            <div>
              <div className="ad-kpi-num">{kpiDelivered}</div>
              <div className="ad-kpi-lbl">Completed Hand-offs</div>
            </div>
          </div>
        </div>

        {/* ── 🎙️ Voice & Text "Ask Delivery AI Operations Copilot" ── */}
        <div className="ad-ai-ask-card mb-4">
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <div className="ad-ai-icon">🚚</div>
            <div className="flex-grow-1">
              <h6 className="ad-ai-title mb-1">🎙️ AI Delivery Operations Copilot</h6>
              <p className="ad-ai-sub mb-0">Ask questions about shipments, pending dispatches, courier SLA, and high-value orders.</p>
            </div>
            <button
              type="button"
              className={`ad-voice-mic-btn ${isListening ? "listening" : ""}`}
              onClick={toggleVoiceSearch}
              title={isListening ? "Listening... Click to stop" : "Speak your query with voice"}
            >
              🎙️ {isListening ? "Listening..." : "Speak"}
            </button>
          </div>

          <form
            className="d-flex gap-2 mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              handleAskDeliveryAi();
            }}
          >
            <input
              type="text"
              className="ad-ai-input flex-grow-1"
              value={deliveryQuery}
              onChange={(e) => setDeliveryQuery(e.target.value)}
              placeholder="e.g. Which orders are pending dispatch today? Or show courier breakdown..."
              disabled={deliveryAnswering}
            />
            <button
              type="submit"
              className="ad-ai-submit-btn"
              disabled={!deliveryQuery.trim() || deliveryAnswering}
            >
              {deliveryAnswering ? "Analyzing..." : "Ask AI"}
            </button>
          </form>

          {/* Quick query chips */}
          <div className="ad-ai-chips mt-2">
            {[
              "📦 What orders are pending dispatch?",
              "🚚 Courier partner breakdown",
              "⚠️ Any high-value orders in transit?",
              "📍 Show delivery performance summary"
            ].map((chip, idx) => (
              <button
                key={idx}
                type="button"
                className="ad-ai-chip"
                onClick={() => {
                  setDeliveryQuery(chip);
                  handleAskDeliveryAi(chip);
                }}
                disabled={deliveryAnswering}
              >
                {chip}
              </button>
            ))}
          </div>

          {deliveryAnswer && (
            <div className="ad-ai-answer-box mt-3">
              <div className="d-flex align-items-center gap-2 mb-1">
                <span className="badge bg-primary">✨ Delivery AI Answer</span>
              </div>
              <p className="ad-ai-answer-text mb-0">{deliveryAnswer}</p>
            </div>
          )}
        </div>

        {/* ── Search and Filter Controls ── */}
        <div className="ad-controls mb-4">
          <input
            className="ad-search-input"
            placeholder="🔍 Search by Order ID, Customer email, Payment ID or Tracking ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="ad-filter-pills">
            {["all", "Confirmed", "Processing", "Shipped", "In Transit", "Out for Delivery", "Delivered"].map((status) => (
              <button
                key={status}
                className={`ad-filter-pill ${statusFilter === status ? "active" : ""}`}
                onClick={() => setStatusFilter(status)}
              >
                {status === "all" ? "All Shipments" : status}
              </button>
            ))}
          </div>
        </div>

        {/* ── Orders Table ── */}
        {loading ? (
          <div className="ad-spinner-box py-5 text-center">
            <div className="spinner-border text-primary" role="status" />
            <p className="mt-2 text-muted">Retrieving delivery logs from cloud server...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="ad-empty-box py-5 text-center">
            <div className="ad-empty-icon">🚚</div>
            <h4>No shipments found</h4>
            <p className="text-muted">Adjust your status filter or try another search search query.</p>
          </div>
        ) : (
          <div className="ad-table-card">
            <div className="table-responsive">
              <table className="ad-table align-middle">
                <thead>
                  <tr>
                    <th>Order Details</th>
                    <th>Recipient &amp; Destination</th>
                    <th>Products Ordered</th>
                    <th>Total Revenue</th>
                    <th>Carrier Partner</th>
                    <th>Tracking Info</th>
                    <th>Milestone Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map(order => (
                    <tr key={order._id}>
                      {/* Order Details */}
                      <td>
                        <span className="order-id">#{order.razorpayOrderId}</span>
                        <div className="order-date">{new Date(order.createdAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</div>
                        <div className="order-payid">PayID: {order.razorpayPaymentId}</div>
                      </td>

                      {/* Recipient */}
                      <td>
                        <span className="cust-email-badge">{order.email}</span>
                        <p className="shipping-addr" title={order.tracking?.shippingAddress || order.shippingAddress}>
                          📍 {order.tracking?.shippingAddress || order.shippingAddress}
                        </p>
                      </td>

                      {/* Products */}
                      <td>
                        <div className="item-cards-wrap">
                          {order.items?.map((item, idx) => (
                            <div key={idx} className="mini-item-card">
                              <span className="mini-item-name">{item.productName || item.name}</span>
                              <span className="mini-item-qty">x{item.qty} {item.selectedSize ? `(${item.selectedSize})` : ""}</span>
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Total */}
                      <td className="fw-bold text-success">
                        ₹{order.totalAmount}.00
                      </td>

                      {/* Carrier */}
                      <td>
                        <span className="carrier-lbl">
                          {order.tracking?.carrier || order.carrier || "Delhivery Express"}
                        </span>
                      </td>

                      {/* Tracking ID */}
                      <td>
                        <span className="tracking-id-badge">
                          📋 {order.tracking?.trackingId || order.trackingId || "Auto-generating..."}
                        </span>
                      </td>

                      {/* Status */}
                      <td>
                        <span className={`ad-status-badge ${getBadgeClass(order.deliveryStatus)}`}>
                          🚚 {order.deliveryStatus}
                        </span>
                      </td>

                      {/* Action */}
                      <td>
                        <button className="ad-manage-btn" onClick={() => openManageModal(order)}>
                          ⚡ Manage Shipment
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Shipment Management Modal ── */}
      {selectedOrder && (
        <div className="ad-modal-backdrop" onClick={() => setSelectedOrder(null)}>
          <div className="ad-modal" onClick={e => e.stopPropagation()}>
            <button className="ad-modal-close" onClick={() => setSelectedOrder(null)}>×</button>
            <h4 className="ad-modal-title">🚚 Manage Shipment: #{selectedOrder.razorpayOrderId}</h4>
            <p className="text-muted mb-4">Update courier details, shipping destination, and dispatch milestones for customer status updates.</p>

            <form onSubmit={handleSaveDelivery}>
              <div className="row g-3">
                {/* Carrier selection */}
                <div className="col-md-6">
                  <label className="form-label">Carrier Partner</label>
                  <select 
                    className="form-select select-field" 
                    value={carrier} 
                    onChange={e => setCarrier(e.target.value)}
                  >
                    {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="Custom Courier">Custom Courier</option>
                  </select>
                </div>

                {/* Tracking ID */}
                <div className="col-md-6">
                  <label className="form-label d-flex justify-content-between">
                    Tracking Identifier
                    <button type="button" className="btn-auto-gen" onClick={handleAutoGenerateTracking}>
                      ✨ Smart Generate
                    </button>
                  </label>
                  <input
                    className="form-control text-field"
                    value={trackingId}
                    onChange={e => setTrackingId(e.target.value)}
                    placeholder="Enter air waybill tracking number..."
                  />
                </div>

                {/* Delivery Address */}
                <div className="col-12">
                  <label className="form-label">Shipping Destination</label>
                  <textarea
                    className="form-control text-area-field"
                    rows="2"
                    value={shippingAddress}
                    onChange={e => setShippingAddress(e.target.value)}
                    placeholder="Enter precise customer delivery address..."
                  />
                </div>

                {/* ✨ AI Delivery & Address Copilot Card */}
                <div className="col-12">
                  <div className="ad-ai-copilot-card p-3 rounded border">
                    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                      <div className="d-flex align-items-center gap-2">
                        <span className="fs-5">✨</span>
                        <div>
                          <strong className="d-block" style={{ fontSize: '13.5px', color: '#0f172a' }}>
                            AI Delivery &amp; RTO Shield Copilot
                          </strong>
                          <span className="text-muted" style={{ fontSize: '11.5px' }}>
                            Standardizes address, predicts RTO failure risk &amp; finds best courier rate
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="ad-ai-analyze-btn"
                        onClick={runAiDeliveryAnalysis}
                        disabled={aiAnalyzing || !shippingAddress.trim()}
                      >
                        {aiAnalyzing ? "✨ Analyzing..." : "✨ Run AI Delivery Analysis"}
                      </button>
                    </div>

                    {aiDeliveryData && (
                      <div className="ad-ai-results mt-3 p-3 bg-white rounded border">
                        {/* 1. Address & RTO */}
                        <div className="row g-2 mb-3">
                          <div className="col-md-7">
                            <div className="small text-muted mb-1 fw-bold">📍 Standardized Delivery Address:</div>
                            <div className="p-2 rounded bg-light border text-dark small">
                              {aiDeliveryData.cleanedAddress}
                            </div>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary mt-1 py-0 px-2"
                              style={{ fontSize: '11px' }}
                              onClick={applyCleanedAddress}
                            >
                              ✅ Apply Clean Address
                            </button>
                          </div>

                          <div className="col-md-5">
                            <div className="small text-muted mb-1 fw-bold">🛡️ RTO Failure Risk Rating:</div>
                            <div className="d-flex align-items-center gap-2">
                              <span className={`badge ${
                                aiDeliveryData.rtoRiskLevel === 'Low' ? 'bg-success' :
                                aiDeliveryData.rtoRiskLevel === 'Moderate' ? 'bg-warning text-dark' : 'bg-danger'
                              } px-2 py-1`}>
                                {aiDeliveryData.rtoRiskScore}% {aiDeliveryData.rtoRiskLevel} Risk
                              </span>
                            </div>
                            <p className="text-muted small mt-1 mb-0" style={{ fontSize: '11px' }}>
                              {aiDeliveryData.rtoRiskReason}
                            </p>
                          </div>
                        </div>

                        {/* 2. Recommended Courier */}
                        <div className="p-2 rounded bg-light border mb-3">
                          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                            <div>
                              <div className="small fw-bold text-dark">
                                ⚡ Recommended Courier: <span className="text-primary">{aiDeliveryData.recommendedCarrier}</span>
                              </div>
                              <div className="text-muted small" style={{ fontSize: '11.5px' }}>
                                ⏱️ {aiDeliveryData.estimatedTransitDays} • 💵 Approx ₹{aiDeliveryData.estimatedShippingCost} • {aiDeliveryData.carrierReason}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary py-1 px-2"
                              style={{ fontSize: '11.5px' }}
                              onClick={applyRecommendedCarrier}
                            >
                              🚚 Select {aiDeliveryData.recommendedCarrier}
                            </button>
                          </div>
                        </div>

                        {/* 3. 1-Click WhatsApp Dispatch */}
                        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 pt-2 border-top">
                          <span className="small text-muted">
                            📲 Send tracking update directly to customer on WhatsApp
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm btn-success py-1 px-3 fw-bold"
                            style={{ fontSize: '12px', background: '#25D366', borderColor: '#25D366' }}
                            onClick={openWhatsAppDispatch}
                          >
                            💬 Open in WhatsApp
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Delhivery Pincode Checker */}
                <div className="col-12">
                  <div className="pincode-checker-box p-3 bg-light rounded border">
                    <label className="form-label fw-bold d-block mb-2">🚚 Delhivery Serviceability Lookup</label>
                    <div className="d-flex gap-2">
                      <input 
                        type="text" 
                        className="form-control text-field" 
                        placeholder="Enter 6-digit Pincode (e.g. 222203)..."
                        maxLength="6"
                        value={lookupPincode}
                        onChange={e => setLookupPincode(e.target.value.replace(/\D/g, ""))}
                      />
                      <button 
                        type="button" 
                        className="ad-manage-btn py-2 px-3" 
                        onClick={handleCheckPincode}
                        disabled={checkingPincode}
                      >
                        {checkingPincode ? "Checking..." : "Verify Service"}
                      </button>
                    </div>
                    {pincodeResult && (
                      <div className="mt-2 small text-dark p-2 bg-white rounded border">
                        {pincodeResult.success ? (
                          pincodeResult.serviceable ? (
                            <span className="text-success fw-bold">
                              🟢 Serviceable! Region: {pincodeResult.region || "Delhivery Network"} 
                              {pincodeResult.district && ` (${pincodeResult.district}, ${pincodeResult.state})`}
                            </span>
                          ) : (
                            <span className="text-danger fw-bold">🔴 Out of Delhivery service area.</span>
                          )
                        ) : (
                          <span className="text-warning fw-bold">⚠️ {pincodeResult.message}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Status Stepper Dropdown */}
                <div className="col-12">
                  <label className="form-label">Active Milestone Status</label>
                  <select
                    className="form-select select-field"
                    value={deliveryStatus}
                    onChange={e => setDeliveryStatus(e.target.value)}
                  >
                    <option value="Confirmed">📦 Confirmed (Verifying and Packing)</option>
                    <option value="Processing">🏷️ Processing (Packed and Labeled)</option>
                    <option value="Shipped">✈️ Shipped (Dispatched from sorting facility)</option>
                    <option value="In Transit">🚚 In Transit (Regional sorting facility)</option>
                    <option value="Out for Delivery">🛵 Out for Delivery (Courier en-route)</option>
                    <option value="Delivered">✅ Delivered &amp; Signed</option>
                  </select>
                </div>

                {/* Visual Timeline Preview */}
                <div className="col-12 mt-4">
                  <div className="timeline-preview-card p-3">
                    <span className="preview-lbl">Customer Stepper Timeline Preview</span>
                    <div className="timeline-horizontal-preview mt-3">
                      {["Confirmed", "Processing", "Shipped", "In Transit", "Out for Delivery", "Delivered"].map((st, sIdx, arr) => {
                        const stages = {
                          "Confirmed": 0, "Processing": 1, "Shipped": 2, "In Transit": 3, "Out for Delivery": 4, "Delivered": 5
                        };
                        const currentVal = stages[deliveryStatus] || 0;
                        const isCompleted = sIdx <= currentVal;
                        const isCurrent = sIdx === currentVal;
                        
                        return (
                          <div key={st} className={`preview-node ${isCompleted ? "completed" : ""} ${isCurrent ? "active" : ""}`}>
                            <div className="preview-dot">{isCompleted ? "✓" : sIdx + 1}</div>
                            <span className="preview-text">{st}</span>
                            {sIdx < arr.length - 1 && <div className="preview-line" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="ad-modal-actions mt-4 text-end">
                <button type="button" className="ad-cancel-btn" onClick={() => setSelectedOrder(null)}>
                  Cancel
                </button>
                <button type="submit" className="ad-save-btn" disabled={saving}>
                  {saving ? "Publishing Updates..." : "Publish Shipment Updates"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};

export default AdminDeliveries;
