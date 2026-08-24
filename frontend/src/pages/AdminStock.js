import { useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, NavLink } from "react-router-dom";
import { toast } from "react-toastify";
import { fetchCategories } from "../app/categorySlice";
import "./AdminStock.css";

const BASE_URL = process.env.REACT_APP_API_URL || "https://final-project1-d3iz.onrender.com";

const AdminStock = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentUser = useSelector((s) => s.users.currentUser);
  const { categories: dbCategories } = useSelector((s) => s.categories);

  // Core State
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [stockStatusFilter, setStockStatusFilter] = useState("all"); // 'all' | 'instock' | 'low' | 'out'
  const [updatingStockId, setUpdatingStockId] = useState(null); // Track inline loading spinner
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkInput, setBulkInput] = useState("");
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);

  // Modern IMS Features State
  const [activeTab, setActiveTab] = useState("inventory"); // 'inventory' | 'advisor' | 'logs'
  const [movements, setMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [insights, setInsights] = useState({ stats: {}, suggestions: [] });
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [lowStockThreshold, setLowStockThreshold] = useState(5);
  const [applyingSuggestionId, setApplyingSuggestionId] = useState(null);

  // AI Inventory Intelligence State
  const [aiAuditData, setAiAuditData] = useState(null);
  const [aiAuditLoading, setAiAuditLoading] = useState(false);
  const [askInput, setAskInput] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askAnswer, setAskAnswer] = useState("");
  const [isVoiceAsking, setIsVoiceAsking] = useState(false);

  useEffect(() => {
    if (!currentUser) navigate("/");
  }, [currentUser, navigate]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/products`);
      const data = await res.json();
      if (data.success) {
        setProducts(data.data);
      }
    } catch {
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  };

  const fetchMovements = async () => {
    setMovementsLoading(true);
    try {
      const token = localStorage.getItem("jwtToken");
      const headers = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${BASE_URL}/api/products/inventory/movements`, { headers });
      const data = await res.json();
      if (data.success) {
        setMovements(data.data);
      }
    } catch {
      console.error("Failed to load stock movements");
    } finally {
      setMovementsLoading(false);
    }
  };

  const fetchInsights = async () => {
    setInsightsLoading(true);
    try {
      const token = localStorage.getItem("jwtToken");
      const headers = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${BASE_URL}/api/products/inventory/insights`, { headers });
      const data = await res.json();
      if (data.success) {
        setInsights(data);
      }
    } catch {
      console.error("Failed to load inventory insights");
    } finally {
      setInsightsLoading(false);
    }
  };

  const runAiAudit = async () => {
    setAiAuditLoading(true);
    try {
      const token = localStorage.getItem("jwtToken");
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${BASE_URL}/api/products/inventory/ai-audit`, {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (data.success) {
        setAiAuditData(data.data);
        if (data.stats) {
          setInsights((prev) => ({ ...prev, stats: data.stats }));
        }
        toast.success("✨ AI Inventory Audit completed!");
      } else {
        toast.error(`AI Audit: ${data.message}`);
      }
    } catch (err) {
      toast.error(`AI Audit Error: ${err.message}`);
    } finally {
      setAiAuditLoading(false);
    }
  };

  const askStockAi = async (questionToAsk) => {
    const q = (questionToAsk || askInput).trim();
    if (!q || askLoading) return;
    setAskLoading(true);
    setAskAnswer("");
    try {
      const token = localStorage.getItem("jwtToken");
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${BASE_URL}/api/products/inventory/ai-ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (data.success) {
        setAskAnswer(data.answer);
      } else {
        setAskAnswer(`⚠️ ${data.message}`);
      }
    } catch (err) {
      setAskAnswer(`⚠️ Network error: ${err.message}`);
    } finally {
      setAskLoading(false);
    }
  };

  const handleVoiceAsk = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.info("Voice recognition not supported in this browser. Try Chrome or Edge!");
      return;
    }

    if (isVoiceAsking) {
      setIsVoiceAsking(false);
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.lang = "en-IN";
      rec.interimResults = false;
      rec.onstart = () => setIsVoiceAsking(true);
      rec.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        setAskInput(transcript);
        setIsVoiceAsking(false);
        askStockAi(transcript);
      };
      rec.onerror = () => setIsVoiceAsking(false);
      rec.onend = () => setIsVoiceAsking(false);
      rec.start();
    } catch (e) {
      console.error(e);
      setIsVoiceAsking(false);
    }
  };

  const handleApplyPricingSuggestion = async (productId, discount) => {
    if (!productId || !discount) return;
    setApplyingSuggestionId(productId);
    try {
      const headers = { "Content-Type": "application/json" };
      const token = localStorage.getItem("jwtToken");
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${BASE_URL}/api/products/${productId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ discount: Number(discount) }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`🏷️ Applied ${discount}% clearance discount!`);
        fetchProducts();
        runAiAudit();
      } else {
        toast.error(data.message || "Failed to update discount");
      }
    } catch {
      toast.error("Failed to update discount");
    } finally {
      setApplyingSuggestionId(null);
    }
  };

  const handleApplyRestockSuggestion = async (productId, suggestedQty) => {
    const product = products.find((p) => p._id === productId);
    const currentStock = product ? (product.stock || 0) : 0;
    const newStock = currentStock + (Number(suggestedQty) || 15);
    await handleStockChange(productId, newStock, `AI Recommended Restock (+${suggestedQty})`);
  };

  useEffect(() => {
    fetchProducts();
    dispatch(fetchCategories());
    fetchMovements();
    fetchInsights();
  }, [dispatch]);

  // Auto-run AI audit when opening advisor tab if not yet loaded
  useEffect(() => {
    if (activeTab === "advisor" && !aiAuditData && !aiAuditLoading) {
      runAiAudit();
    }
  }, [activeTab]);

  // Derived categories
  const categoryNames = dbCategories
    .filter((c) => c.isActive)
    .map((c) => c.name);
  const productCats = [...new Set(products.map((p) => p.category).filter(Boolean))];
  const allCategoryNames = categoryNames.length > 0 ? categoryNames : productCats;

  // Single Stock Update
  const handleStockChange = async (id, newStock, reason = "Manual stock adjustment") => {
    if (newStock < 0) return;
    setUpdatingStockId(id);
    try {
      const headers = { "Content-Type": "application/json" };
      const token = localStorage.getItem("jwtToken");
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${BASE_URL}/api/products/${id}/stock`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ 
          stock: newStock,
          reason,
          updatedBy: currentUser?.name || "Admin"
        }),
      });
      const data = await res.json();
      if (data.success) {
        setProducts((prev) =>
          prev.map((p) => (p._id === id ? { ...p, stock: data.data.stock } : p))
        );
        toast.success(`Stock updated to ${data.data.stock}`);
        fetchMovements(); // Refresh logs
        fetchInsights();  // Refresh insights
      } else {
        toast.error(data.message || "Failed to update stock");
      }
    } catch {
      toast.error("Failed to update stock");
    } finally {
      setUpdatingStockId(null);
    }
  };

  // ── Parse CSV and apply size-aware stock updates ──────────────────────────
  const parseCsvAndUpdate = async (csvText) => {
    const lines = csvText.trim().split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return { successCount: 0, failCount: 0 };

    const hasHeaders = lines[0].toLowerCase().includes("product name") || 
                       lines[0].toLowerCase().includes("product id") || 
                       lines[0].toLowerCase().includes("stock") ||
                       lines[0].toLowerCase().includes("qty");

    let idIdx = 0, nameIdx = 0, sizeIdx = 1, qtyIdx = 2; // Defaults if no headers

    if (hasHeaders) {
      const firstLine = lines[0].toLowerCase();
      // Robust split for headers
      const headers = [];
      let curr = '', inQ = false;
      for (let i = 0; i < firstLine.length; i++) {
        const c = firstLine[i];
        if (c === '"') inQ = !inQ;
        else if (c === ',' && !inQ) { headers.push(curr.trim().replace(/^"|"$/g, "")); curr = ''; }
        else curr += c;
      }
      headers.push(curr.trim().replace(/^"|"$/g, ""));

      idIdx = headers.findIndex(h => h === "product id" || h === "id");
      nameIdx = headers.findIndex(h => h === "product name" || h === "name" || h === "product");
      sizeIdx = headers.findIndex(h => h === "size" || h === "product size");
      qtyIdx = headers.findIndex(h => h === "size stock" || h === "stock" || h === "total stock" || h === "quantity" || h === "qty");

      if (idIdx === -1) idIdx = nameIdx; // fallback to name
      if (qtyIdx === -1) qtyIdx = headers.indexOf("total stock") !== -1 ? headers.indexOf("total stock") : 2;
      if (sizeIdx === -1) sizeIdx = headers.indexOf("size") !== -1 ? headers.indexOf("size") : 1;
    }

    const dataLines = hasHeaders ? lines.slice(1) : lines;
    const productUpdates = {};

    for (const rawLine of dataLines) {
      // Robust CSV parser to handle empty fields correctly (e.g. A,,C)
      const parts = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < rawLine.length; i++) {
        const char = rawLine[i];
        if (char === '"') {
          if (inQuotes && rawLine[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          parts.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      parts.push(current.trim());
      
      if (parts.length === 0 || (parts.length === 1 && parts[0] === "")) continue;

      const pId = idIdx !== -1 && parts[idIdx] ? parts[idIdx] : "";
      const pName = nameIdx !== -1 && parts[nameIdx] ? parts[nameIdx] : "";
      const sizeVal = sizeIdx !== -1 && parts[sizeIdx] ? parts[sizeIdx] : "-";
      
      let qtyVal = qtyIdx !== -1 && parts[qtyIdx] ? parseInt(parts[qtyIdx].replace(/[^\d-]/g, '')) : NaN;
      if (isNaN(qtyVal) || qtyVal < 0) continue;

      // Find product by ID exactly, or by name fallback (case-insensitive)
      const found = products.find(
        (p) => (pId && p._id === pId) || (pName && p.productName.toLowerCase() === pName.toLowerCase())
      );

      if (!found) continue;
      const id = found._id;

      if (!productUpdates[id]) {
        productUpdates[id] = { product: found, sizeStockPatch: {}, flatStock: null };
      }

      if (!sizeVal || sizeVal === "-" || sizeVal.toLowerCase() === "none") {
        productUpdates[id].flatStock = qtyVal;
      } else {
        productUpdates[id].sizeStockPatch[sizeVal] = qtyVal;
      }
    }

    const token = localStorage.getItem("jwtToken");
    const authHeaders = { "Content-Type": "application/json" };
    if (token) authHeaders["Authorization"] = `Bearer ${token}`;
    let successCount = 0; let failCount = 0;

    for (const { product, sizeStockPatch, flatStock } of Object.values(productUpdates)) {
      try {
        const hasSizes = Object.keys(sizeStockPatch).length > 0;
        const body = hasSizes
          ? { sizeStock: { ...(product.sizeStock || {}), ...sizeStockPatch }, reason: "Bulk CSV Import", updatedBy: currentUser?.name || "Admin" }
          : { stock: flatStock !== null ? flatStock : product.stock, reason: "Bulk CSV Import", updatedBy: currentUser?.name || "Admin" };
        const res  = await fetch(`${BASE_URL}/api/products/${product._id}/stock`, {
          method: "PATCH", headers: authHeaders, body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success) successCount++; else failCount++;
      } catch { failCount++; }
    }
    return { successCount, failCount };
  };

  // ── Bulk import from pasted CSV text ──────────────────────────────────────
  const handleBulkUpdate = async (e) => {
    e.preventDefault();
    if (!bulkInput.trim()) { toast.error("Please enter CSV data"); return; }
    setImporting(true);
    toast.info("Processing bulk updates...");
    try {
      const { successCount, failCount } = await parseCsvAndUpdate(bulkInput);
      if (successCount > 0) { toast.success(`Updated ${successCount} product(s)!`); fetchProducts(); fetchMovements(); fetchInsights(); }
      if (failCount > 0) toast.warn(`Failed or skipped ${failCount} row(s).`);
      if (successCount === 0 && failCount === 0) toast.error("No matching products found.");
    } finally { setImporting(false); setShowBulkModal(false); setBulkInput(""); }
  };

  // ── Bulk import from uploaded .csv file ───────────────────────────────────
  const handleFileImport = async (e) => {
    e.preventDefault();
    if (!importFile) { toast.error("Please select a CSV file"); return; }
    setImporting(true);
    toast.info("Reading CSV file...");
    try {
      const text = await importFile.text();
      const { successCount, failCount } = await parseCsvAndUpdate(text);
      if (successCount > 0) { toast.success(`Updated ${successCount} product(s) from file!`); fetchProducts(); fetchMovements(); fetchInsights(); }
      if (failCount > 0) toast.warn(`Failed or skipped ${failCount} row(s).`);
      if (successCount === 0 && failCount === 0) toast.error("No matching products found in file.");
    } catch { toast.error("Failed to read CSV file"); }
    finally { setImporting(false); setShowBulkModal(false); setImportFile(null); }
  };



  // Applying AI dynamic pricing advice
  const handleApplyPricingSuggestion = async (productId, discountPercent) => {
    setApplyingSuggestionId(productId);
    try {
      const token = localStorage.getItem("jwtToken");
      const headers = { 
        "Content-Type": "application/json"
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // Call Product PUT /api/products/:id to adjust discount
      const res = await fetch(`${BASE_URL}/api/products/${productId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          discount: discountPercent,
          reason: "AI Pricing Optimization",
          updatedBy: currentUser?.name || "AI Advisor"
        })
      });

      const data = await res.json();
      if (data.success) {
        toast.success(`Applied AI recommendation: ${discountPercent}% discount!`);
        fetchProducts();
        fetchInsights();
      } else {
        toast.error(data.message || "Failed to apply AI suggestion");
      }
    } catch {
      toast.error("Error communicating with servers");
    } finally {
      setApplyingSuggestionId(null);
    }
  };

  // ── CSV Export (size-aware) ──────────────────────────────────────────────
  const exportToCSV = () => {
    if (products.length === 0) { toast.error("No data to export"); return; }

    const rows = ["Product Name,Product ID,Category,Price,Size,Size Stock,Total Stock,Status"];

    filteredProducts.forEach((p) => {
      const totalStock = p.stock || 0;
      const status = totalStock === 0 ? "Out of Stock" : totalStock <= lowStockThreshold ? "Low Stock" : "In Stock";
      const safeName = (p.productName || "").replace(/"/g, '""');
      const safeCat  = (p.category  || "").replace(/"/g, '""');

      const ss = p.sizeStock && typeof p.sizeStock === "object" ? p.sizeStock : {};
      const sizeEntries = Object.entries(ss).filter(([, v]) => v !== undefined);

      if (sizeEntries.length > 0) {
        sizeEntries.forEach(([size, qty]) => {
          rows.push(`"${safeName}",${p._id},"${safeCat}",${p.price},${size},${qty || 0},${totalStock},"${status}"`);
        });
      } else {
        rows.push(`"${safeName}",${p._id},"${safeCat}",${p.price},-,${totalStock},${totalStock},"${status}"`);
      }
    });

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `stock_size_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("📊 Size-aware stock CSV exported!");
  };



  // Filtering Logic
  const filteredProducts = products.filter((p) => {
    const matchCat = catFilter === "all" || p.category === catFilter;
    const matchSearch = p.productName.toLowerCase().includes(search.toLowerCase());
    
    let matchStatus = true;
    if (stockStatusFilter === "instock") {
      matchStatus = (p.stock || 0) > lowStockThreshold;
    } else if (stockStatusFilter === "low") {
      matchStatus = (p.stock || 0) > 0 && (p.stock || 0) <= lowStockThreshold;
    } else if (stockStatusFilter === "out") {
      matchStatus = (p.stock || 0) === 0;
    }

    return matchCat && matchSearch && matchStatus;
  });

  // Summary Metrics
  const totalStock = products.reduce((s, p) => s + (p.stock || 0), 0);
  const outOfStock = products.filter((p) => (p.stock || 0) === 0).length;
  const lowStock = products.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= lowStockThreshold).length;
  
  // Calculate total locked capital (valuation sum)
  const lockedCapital = products.reduce((s, p) => s + ((p.stock || 0) * p.price), 0);

  const getStockBadge = (stock) => {
    if (stock === 0) return <span className="as-badge badge-out">Out of Stock</span>;
    if (stock <= lowStockThreshold) return <span className="as-badge badge-low">Low Stock</span>;
    return <span className="as-badge badge-ok">In Stock</span>;
  };

  // Category aggregations for progress bars
  const categorySummaryMap = {};
  products.forEach(p => {
    if (!categorySummaryMap[p.category]) {
      categorySummaryMap[p.category] = { count: 0, stock: 0 };
    }
    categorySummaryMap[p.category].count += 1;
    categorySummaryMap[p.category].stock += (p.stock || 0);
  });

  if (!currentUser) return null;

  return (
    <section className="as-page-wrapper">
      <div className="container-fluid px-4 py-4">
        {/* Navigation tabs */}
        <div className="admin-nav-tabs mb-4">
          <NavLink to="/admin/users" className={({ isActive }) => `admin-nav-tab${isActive ? " active" : ""}`}>👥 Users</NavLink>
          <NavLink to="/admin/products" className={({ isActive }) => `admin-nav-tab${isActive ? " active" : ""}`}>🛍️ Products</NavLink>
          <NavLink to="/admin/categories" className={({ isActive }) => `admin-nav-tab${isActive ? " active" : ""}`}>🗂️ Categories</NavLink>
          <NavLink to="/admin/bills" className={({ isActive }) => `admin-nav-tab${isActive ? " active" : ""}`}>🧾 Bills</NavLink>
          <NavLink to="/admin/customers" className={({ isActive }) => `admin-nav-tab${isActive ? " active" : ""}`}>👤 Customers</NavLink>
          <NavLink to="/admin/stock" className={({ isActive }) => `admin-nav-tab${isActive ? " active" : ""}`}>📦 Stock</NavLink>
          <NavLink to="/admin/discounts" className={({ isActive }) => `admin-nav-tab${isActive ? " active" : ""}`}>🏷️ Discounts</NavLink>
          <NavLink to="/admin/settings" className={({ isActive }) => `admin-nav-tab${isActive ? " active" : ""}`}>⚙️ Settings</NavLink>
          <NavLink to="/admin/deliveries" className={({ isActive }) => `admin-nav-tab${isActive ? " active" : ""}`}>🚚 Deliveries</NavLink>
        </div>

        {/* Dashboard Header */}
        <div className="as-header">
          <div>
            <h2 className="as-title">
              Next-Gen Stock Control
              <span className="as-title-underline" />
            </h2>
            <p className="as-subtitle">Predictive analytics, automated log tracking, and real-time inventory assets</p>
          </div>
          <div className="as-header-actions">
            {/* Tab switch control */}
            <div className="ims-tab-buttons me-2">
              <button 
                className={`ims-tab-btn ${activeTab === "inventory" ? "active" : ""}`}
                onClick={() => setActiveTab("inventory")}
              >
                📊 Inventory
              </button>
              <button 
                className={`ims-tab-btn ${activeTab === "advisor" ? "active" : ""}`}
                onClick={() => setActiveTab("advisor")}
              >
                🧠 AI Copilot {insights?.suggestions?.length > 0 && <span className="advisor-count-dot">{insights.suggestions.length}</span>}
              </button>
              <button 
                className={`ims-tab-btn ${activeTab === "logs" ? "active" : ""}`}
                onClick={() => setActiveTab("logs")}
              >
                📜 Live Logs
              </button>
            </div>
            
            <button className="as-btn as-btn-secondary" onClick={() => setShowBulkModal(true)}>
              📥 Bulk Import
            </button>
            <button className="as-btn as-btn-primary" onClick={exportToCSV}>
              📤 Export CSV
            </button>
          </div>
        </div>

        {/* Dynamic Metric Cards */}
        <div className="as-metrics-grid">
          <div className="as-metric-card">
            <div className="as-metric-inner">
              <span className="as-metric-icon">💼</span>
              <div>
                <h3 className="as-metric-num">₹{lockedCapital.toLocaleString()}</h3>
                <span className="as-metric-label">Locked Capital</span>
              </div>
            </div>
            <div className="as-metric-glow color-blue" />
          </div>

          <div className="as-metric-card">
            <div className="as-metric-inner">
              <span className="as-metric-icon">📦</span>
              <div>
                <h3 className="as-metric-num">{totalStock}</h3>
                <span className="as-metric-label">Total Units</span>
              </div>
            </div>
            <div className="as-metric-glow color-blue" />
          </div>

          <div className={`as-metric-card ${lowStock > 0 ? "critical-pulse" : ""}`}>
            <div className="as-metric-inner">
              <span className="as-metric-icon">⚠️</span>
              <div>
                <h3 className="as-metric-num">{lowStock}</h3>
                <span className="as-metric-label">Low Stock (≤{lowStockThreshold})</span>
              </div>
            </div>
            <div className="as-metric-glow color-orange" />
          </div>

          <div className={`as-metric-card ${outOfStock > 0 ? "critical-pulse" : ""}`}>
            <div className="as-metric-inner">
              <span className="as-metric-icon">🚫</span>
              <div>
                <h3 className="as-metric-num">{outOfStock}</h3>
                <span className="as-metric-label">Out of Stock</span>
              </div>
            </div>
            <div className="as-metric-glow color-red" />
          </div>
        </div>

        {/* Category breakdown visual charts */}
        {activeTab === "inventory" && Object.keys(categorySummaryMap).length > 0 && (
          <div className="category-analytics-panel mb-4">
            <h4 className="panel-title">📦 Category Asset Allocation</h4>
            <div className="category-progress-grid">
              {Object.keys(categorySummaryMap).map((catName) => {
                const summary = categorySummaryMap[catName];
                const percentage = Math.min(100, Math.max(12, (summary.stock / (totalStock || 1)) * 100));
                return (
                  <div key={catName} className="cat-progress-card">
                    <div className="cat-progress-header">
                      <span className="cat-name">{catName}</span>
                      <span className="cat-details">{summary.stock} Units ({summary.count} items)</span>
                    </div>
                    <div className="cat-progress-bar-bg">
                      <div className="cat-progress-bar-fill" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TAB 1: INVENTORY MANAGER ────────────────────────────────────────── */}
        {activeTab === "inventory" && (
          <>
            {/* Glassmorphic Filtering Control Center */}
            <div className="as-control-center">
              <div className="as-search-box">
                <span className="as-search-icon">🔍</span>
                <input
                  type="text"
                  placeholder="Search products by name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="as-filter-group">
                <div className="as-filter-wrapper">
                  <label>Warning Limit</label>
                  <input
                    type="number"
                    className="threshold-input"
                    value={lowStockThreshold}
                    min="1"
                    max="100"
                    onChange={(e) => setLowStockThreshold(parseInt(e.target.value) || 5)}
                  />
                </div>

                <div className="as-filter-wrapper">
                  <label>Category</label>
                  <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                    <option value="all">All Categories</option>
                    {allCategoryNames.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="as-filter-wrapper">
                  <label>Stock Status</label>
                  <select value={stockStatusFilter} onChange={(e) => setStockStatusFilter(e.target.value)}>
                    <option value="all">All Statuses</option>
                    <option value="instock">In Stock</option>
                    <option value="low">Low Stock</option>
                    <option value="out">Out of Stock</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Interactive Stock Table */}
            {loading ? (
              <div className="as-loader-container">
                <div className="as-spinner" />
                <p>Syncing warehouse data...</p>
              </div>
            ) : (
              <div className="as-table-container">
                <table className="as-table">
                  <thead>
                    <tr>
                      <th>Product Details</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Stock Levels</th>
                      <th>Status</th>
                      <th>Interactive Control</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="as-table-empty">
                          No matching inventory items found.
                        </td>
                      </tr>
                    ) : (
                      filteredProducts.map((p) => {
                        const isUpdating = updatingStockId === p._id;
                        const isLow = (p.stock || 0) > 0 && (p.stock || 0) <= lowStockThreshold;
                        const isOut = (p.stock || 0) === 0;

                        return (
                          <tr key={p._id} className={isOut ? "row-out" : isLow ? "row-low" : ""}>
                            <td>
                              <div className="as-product-info">
                                {p.imgUrl ? (
                                  <img src={p.imgUrl} alt={p.productName} className="as-product-thumb" />
                                ) : (
                                  <div className="as-product-placeholder">📦</div>
                                )}
                                <div>
                                  <span className="as-product-name">{p.productName}</span>
                                  <span className="as-product-id">ID: {p._id.slice(-6)}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="as-category-tag">{p.category}</span>
                            </td>
                            <td>
                              <span className="as-price-tag">₹{p.price}</span>
                            </td>
                            <td>
                              {/* If product has per-size stock, show breakdown; else show counter */}
                              {p.sizeStock && Object.keys(p.sizeStock).length > 0 ? (
                                <div className="as-size-stock-wrap">
                                  <div className="as-size-stock-grid">
                                    {Object.entries(p.sizeStock).map(([sz, qty]) => (
                                      <div key={sz} className="as-size-stock-cell">
                                        <span className="as-size-tag">{sz}</span>
                                        <input
                                          type="number" min="0"
                                          className="as-size-qty-input"
                                          value={qty}
                                          disabled={isUpdating}
                                          onChange={(e) => {
                                            const val = Number(e.target.value) || 0;
                                            setProducts((prev) => prev.map((x) => {
                                              if (x._id !== p._id) return x;
                                              const newSS = { ...(x.sizeStock || {}), [sz]: val };
                                              const total = Object.values(newSS).reduce((s,v) => s + Number(v||0), 0);
                                              return { ...x, sizeStock: newSS, stock: total };
                                            }));
                                          }}
                                          onBlur={async () => {
                                            // Save per-size stock via PATCH
                                            const cur = products.find(x => x._id === p._id);
                                            if (!cur) return;
                                            const headers = { "Content-Type": "application/json" };
                                            const token = localStorage.getItem("jwtToken");
                                            if (token) headers["Authorization"] = `Bearer ${token}`;
                                            setUpdatingStockId(p._id);
                                            try {
                                              const res = await fetch(`${BASE_URL}/api/products/${p._id}/stock`, {
                                                method: "PATCH", headers,
                                                body: JSON.stringify({
                                                  sizeStock: cur.sizeStock,
                                                  reason: "Per-size stock update",
                                                  updatedBy: currentUser?.name || "Admin"
                                                }),
                                              });
                                              const data = await res.json();
                                              if (data.success) {
                                                toast.success(`Stock updated`);
                                                fetchMovements();
                                              }
                                            } catch { toast.error("Update failed"); }
                                            finally { setUpdatingStockId(null); }
                                          }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="as-size-total">
                                    Total: <strong>{Object.values(p.sizeStock).reduce((s,v) => s + Number(v||0), 0)}</strong> units
                                  </div>
                                </div>
                              ) : (
                                <div className="as-stock-counter">
                                  <button
                                    className="as-counter-btn"
                                    onClick={() => handleStockChange(p._id, (p.stock || 0) - 1, "Manual deduction")}
                                    disabled={isUpdating || (p.stock || 0) <= 0}
                                  >
                                    −
                                  </button>
                                  <input
                                    type="number"
                                    className="as-counter-input"
                                    value={p.stock || 0}
                                    min="0"
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value);
                                      setProducts((prev) =>
                                        prev.map((x) => (x._id === p._id ? { ...x, stock: isNaN(val) ? 0 : val } : x))
                                      );
                                    }}
                                    onBlur={(e) => handleStockChange(p._id, parseInt(e.target.value) || 0, "Counter update")}
                                    disabled={isUpdating}
                                  />
                                  <button
                                    className="as-counter-btn"
                                    onClick={() => handleStockChange(p._id, (p.stock || 0) + 1, "Manual restock")}
                                    disabled={isUpdating}
                                  >
                                    +
                                  </button>
                                  {isUpdating && <div className="as-small-spinner" />}
                                </div>
                              )}
                            </td>
                            <td>{getStockBadge(p.stock || 0)}</td>
                            <td>
                              <button
                                className="as-action-update-btn"
                                onClick={() => handleStockChange(p._id, p.stock || 0, "Manual sync")}
                                disabled={isUpdating}
                              >
                                💾 Sync Stock
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── TAB 2: AI INVENTORY COPILOT & ADVISOR ───────────────────────────── */}
        {activeTab === "advisor" && (
          <div className="ai-advisor-panel">
            {/* Executive AI Header */}
            <div className="ai-panel-header glass-card p-4 mb-4">
              <div className="ai-header-info">
                <span className="ai-brain-icon">✨</span>
                <div>
                  <h4 className="mb-1">AI Inventory Intelligence & Predictive Advisor</h4>
                  <p className="mb-0 text-muted">
                    Real-time stockout forecasts, dead-stock capital liberation, and automated 1-click reorders powered by Gemini AI.
                  </p>
                </div>
              </div>
              <button
                className={`as-btn as-btn-primary ${aiAuditLoading ? "as-btn-loading" : ""}`}
                onClick={runAiAudit}
                disabled={aiAuditLoading}
              >
                {aiAuditLoading ? (
                  <><span className="ai-spinner me-2" /> Running Deep Audit…</>
                ) : (
                  <>✨ Run AI Inventory Audit</>
                )}
              </button>
            </div>

            {/* 🎙️ Natural Language & Voice "Ask Stock AI" Bar */}
            <div className="ai-ask-bar glass-card p-4 mb-4">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <div className="d-flex align-items-center gap-2">
                  <span className="ai-ask-icon">💬</span>
                  <h6 className="mb-0 font-bold">Ask Stock AI Assistant</h6>
                </div>
                <span className="text-xs text-muted">🎙️ Voice & natural language warehouse assistant</span>
              </div>

              <form
                className="ai-ask-form d-flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  askStockAi();
                }}
              >
                <button
                  type="button"
                  className={`as-voice-btn ${isVoiceAsking ? "listening" : ""}`}
                  onClick={handleVoiceAsk}
                  title={isVoiceAsking ? "Stop Listening" : "Speak Voice Command"}
                >
                  {isVoiceAsking ? "🛑" : "🎙️"}
                </button>
                <input
                  type="text"
                  className="as-input flex-grow-1"
                  value={askInput}
                  onChange={(e) => setAskInput(e.target.value)}
                  placeholder={isVoiceAsking ? "Listening to your voice command..." : "e.g. Which category has the most unsold capital? or What should I restock?"}
                  disabled={askLoading}
                />
                <button
                  type="submit"
                  className="as-btn as-btn-primary px-4"
                  disabled={!askInput.trim() || askLoading}
                >
                  {askLoading ? "Searching..." : "Ask AI"}
                </button>
              </form>

              {/* Quick Prompt Chips */}
              <div className="ai-ask-chips d-flex flex-wrap gap-2 mt-3">
                {[
                  "Which items are in danger of stocking out?",
                  "How much dead stock do we have right now?",
                  "What is our highest-value inventory category?",
                  "Suggest clearance sales for this weekend",
                ].map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="ai-ask-chip"
                    onClick={() => {
                      setAskInput(chip);
                      askStockAi(chip);
                    }}
                    disabled={askLoading}
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* AI Answer Box */}
              {askAnswer && (
                <div className="ai-answer-box mt-3 p-3 glass-card">
                  <div className="d-flex align-items-center gap-2 text-primary font-bold mb-1">
                    <span>🤖 Nilex Stock AI</span>
                  </div>
                  <p className="mb-0 text-dark" style={{ whiteSpace: "pre-wrap", fontSize: "14px", lineHeight: "1.6" }}>
                    {askAnswer}
                  </p>
                </div>
              )}
            </div>

            {aiAuditLoading && !aiAuditData ? (
              <div className="as-loader-container">
                <div className="as-spinner" />
                <p>Gemini AI is auditing inventory velocities, profit valuations, and stock health...</p>
              </div>
            ) : (
              <div className="insights-workspace">
                {/* Health Score & Key Financial Metrics Banner */}
                <div className="row g-3 mb-4">
                  <div className="col-md-3">
                    <div className="glass-card p-3 d-flex align-items-center gap-3">
                      <div className="health-score-badge">
                        <span className="health-score-num">{aiAuditData?.healthScore || 85}</span>
                        <span className="health-score-denom">/100</span>
                      </div>
                      <div>
                        <span className="stat-label">Health Score</span>
                        <h6 className="mb-0 font-bold text-success">{aiAuditData?.healthStatus || "Good Health"}</h6>
                      </div>
                    </div>
                  </div>

                  <div className="col-md-3">
                    <div className="glass-card p-3">
                      <span className="stat-label">Total Stock Assets</span>
                      <h5 className="mb-0 text-primary font-bold">
                        ₹{insights?.stats?.totalValuation?.toLocaleString() || lockedCapital.toLocaleString()}
                      </h5>
                      <span className="text-xs text-muted">{products.length} catalog items</span>
                    </div>
                  </div>

                  <div className="col-md-3">
                    <div className="glass-card p-3">
                      <span className="stat-label">Locked in Dead Stock</span>
                      <h5 className="mb-0 text-danger font-bold">
                        ₹{aiAuditData?.lockedCapitalInDeadStock?.toLocaleString() || (aiAuditData?.deadStockAlerts?.reduce((s, a) => s + (a.lockedCapital || 0), 0) || 0).toLocaleString()}
                      </h5>
                      <span className="text-xs text-muted">Capital eligible for liquidation</span>
                    </div>
                  </div>

                  <div className="col-md-3">
                    <div className="glass-card p-3">
                      <span className="stat-label">Critical Restock Alerts</span>
                      <h5 className="mb-0 text-warning font-bold">
                        {aiAuditData?.restockAlerts?.length || 0} Products
                      </h5>
                      <span className="text-xs text-muted">Immediate replenishment required</span>
                    </div>
                  </div>
                </div>

                {/* Executive Summary Briefing */}
                {aiAuditData?.executiveSummary && (
                  <div className="glass-card p-4 mb-4 border-left-info">
                    <div className="d-flex align-items-center gap-2 mb-2">
                      <span className="badge bg-primary text-white">📋 Executive AI Briefing</span>
                    </div>
                    <p className="mb-0 text-dark" style={{ fontSize: "14.5px", lineHeight: "1.6" }}>
                      {aiAuditData.executiveSummary}
                    </p>
                  </div>
                )}

                <div className="row g-4">
                  {/* Left Column: Restock & Dead Stock Action Cards */}
                  <div className="col-lg-8">
                    {/* 🚨 High Priority Restock Section */}
                    <div className="mb-4">
                      <div className="d-flex align-items-center justify-content-between mb-3">
                        <h5 className="section-subtitle mb-0">🚨 Predictive Restock Alerts</h5>
                        <span className="badge bg-danger">Action Recommended</span>
                      </div>

                      {(!aiAuditData?.restockAlerts || aiAuditData.restockAlerts.length === 0) ? (
                        <div className="glass-card p-4 text-center text-muted">
                          ✅ No immediate stockout risks detected. All active products have sufficient buffer.
                        </div>
                      ) : (
                        <div className="d-flex flex-column gap-3">
                          {aiAuditData.restockAlerts.map((item, idx) => (
                            <div key={idx} className="suggestion-card glass-card p-4 border-left-high d-flex justify-content-between align-items-start gap-3">
                              <div className="flex-grow-1">
                                <div className="d-flex align-items-center gap-2 mb-1">
                                  <span className="severity-tag severity-high">{item.urgency || "High"} Urgency</span>
                                  <span className="text-xs text-muted">Current Stock: <strong>{item.currentStock}</strong> units</span>
                                </div>
                                <h6 className="font-bold text-dark mb-1">{item.productName}</h6>
                                <p className="text-sm text-secondary mb-2">{item.reasoning}</p>
                                {item.estimatedCost && (
                                  <div className="text-xs text-primary font-bold">
                                    Estimated Restock Investment: ₹{item.estimatedCost.toLocaleString()}
                                  </div>
                                )}
                              </div>

                              <button
                                className="as-btn as-btn-primary py-2 px-3 text-xs flex-shrink-0"
                                onClick={() => handleApplyRestockSuggestion(item.productId, item.suggestedRestockQty || 20)}
                                disabled={updatingStockId === item.productId}
                                title={`Add ${item.suggestedRestockQty || 20} units directly to stock`}
                              >
                                {updatingStockId === item.productId ? (
                                  "Updating…"
                                ) : (
                                  `⚡ 1-Click Restock (+${item.suggestedRestockQty || 20})`
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 🧊 Dead Stock Liquidation Section */}
                    <div>
                      <div className="d-flex align-items-center justify-content-between mb-3">
                        <h5 className="section-subtitle mb-0">🧊 Dead Stock Liquidation Strategies</h5>
                        <span className="badge bg-warning text-dark">Unlock Cashflow</span>
                      </div>

                      {(!aiAuditData?.deadStockAlerts || aiAuditData.deadStockAlerts.length === 0) ? (
                        <div className="glass-card p-4 text-center text-muted">
                          ✅ Inventory turnover is healthy! No stagnant dead stock identified.
                        </div>
                      ) : (
                        <div className="d-flex flex-column gap-3">
                          {aiAuditData.deadStockAlerts.map((item, idx) => {
                            const isApplying = applyingSuggestionId === item.productId;
                            return (
                              <div key={idx} className="suggestion-card glass-card p-4 border-left-medium d-flex justify-content-between align-items-start gap-3">
                                <div className="flex-grow-1">
                                  <div className="d-flex align-items-center gap-2 mb-1">
                                    <span className="severity-tag severity-medium">Stagnant Stock</span>
                                    <span className="text-xs text-muted">Stock: <strong>{item.currentStock}</strong> units</span>
                                    {item.lockedCapital && (
                                      <span className="text-xs text-danger font-bold">
                                        (₹{item.lockedCapital.toLocaleString()} locked)
                                      </span>
                                    )}
                                  </div>
                                  <h6 className="font-bold text-dark mb-1">{item.productName}</h6>
                                  <p className="text-sm text-secondary mb-2">{item.actionPlan}</p>
                                </div>

                                <button
                                  className="as-btn as-btn-secondary py-2 px-3 text-xs flex-shrink-0"
                                  onClick={() => handleApplyPricingSuggestion(item.productId, item.suggestedDiscount || 15)}
                                  disabled={isApplying}
                                  title={`Apply ${item.suggestedDiscount || 15}% clearance discount`}
                                >
                                  {isApplying ? "Applying…" : `🏷️ Apply ${item.suggestedDiscount || 15}% Sale`}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Seasonal Demand Trends & Category Valuations */}
                  <div className="col-lg-4">
                    {/* 📈 Seasonal Insights */}
                    <div className="glass-card p-4 mb-4">
                      <h6 className="section-subtitle d-flex align-items-center gap-2 mb-3">
                        <span>📈</span> Seasonal Demand Forecast
                      </h6>

                      {(!aiAuditData?.seasonalTips || aiAuditData.seasonalTips.length === 0) ? (
                        <p className="text-sm text-muted mb-0">
                          Demand across all primary categories is steady for the current retail quarter.
                        </p>
                      ) : (
                        <div className="d-flex flex-column gap-3">
                          {aiAuditData.seasonalTips.map((tip, idx) => (
                            <div key={idx} className="seasonal-tip-card p-3 rounded bg-light border">
                              <span className="badge bg-primary text-white mb-1">{tip.category}</span>
                              <p className="text-xs text-dark mb-1 font-bold">{tip.trendAdvice}</p>
                              <p className="text-xs text-muted mb-0">{tip.recommendation}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 📊 Category Asset Distribution */}
                    <div className="glass-card p-4">
                      <h6 className="section-subtitle mb-3">📊 Category Asset Distribution</h6>
                      <div className="d-flex flex-column gap-3">
                        {Object.entries(categorySummaryMap).map(([cat, info]) => {
                          const catVal = products
                            .filter((p) => p.category === cat)
                            .reduce((s, p) => s + (p.stock || 0) * p.price, 0);
                          const percentage = lockedCapital > 0 ? Math.round((catVal / lockedCapital) * 100) : 0;

                          return (
                            <div key={cat} className="category-val-item">
                              <div className="d-flex justify-content-between text-xs mb-1">
                                <span className="font-bold">{cat}</span>
                                <span className="text-primary font-bold">₹{catVal.toLocaleString()} ({percentage}%)</span>
                              </div>
                              <div className="progress" style={{ height: "6px" }}>
                                <div
                                  className="progress-bar bg-primary"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: LIVE STOCK MOVEMENT LOGS ─────────────────────────────────── */}
        {activeTab === "logs" && (
          <div className="logs-panel glass-card p-4">
            <div className="panel-header mb-4 d-flex justify-content-between align-items-center">
              <div>
                <h4 className="panel-title">📜 Chronological Stock Ledger</h4>
                <p className="panel-subtitle">Real-time ledger tracking every change in quantity, timestamps, reasons, and actors.</p>
              </div>
              <button className="as-btn as-btn-secondary" onClick={fetchMovements} disabled={movementsLoading}>
                {movementsLoading ? "Syncing..." : "🔄 Refresh Logs"}
              </button>
            </div>

            {movementsLoading ? (
              <div className="as-loader-container">
                <div className="as-spinner" />
                <p>Syncing warehouse transaction records...</p>
              </div>
            ) : (
              <div className="ledger-table-container">
                <table className="as-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Product Name</th>
                      <th>Quantity Change</th>
                      <th>Final Stock</th>
                      <th>Action Type</th>
                      <th>Adjustment Reason</th>
                      <th>Staff Member</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="as-table-empty">
                          No inventory movement logs recorded yet. Logs will generate automatically when product stocks are modified!
                        </td>
                      </tr>
                    ) : (
                      movements.map((log) => {
                        const isPositive = log.changeQty > 0;
                        return (
                          <tr key={log._id}>
                            <td className="text-muted text-xs">
                              {new Date(log.createdAt).toLocaleString()}
                            </td>
                            <td>
                              <span className="font-semibold text-white">{log.productName}</span>
                            </td>
                            <td>
                              <span className={`log-change-badge ${isPositive ? 'log-in' : 'log-out'}`}>
                                {isPositive ? `+${log.changeQty}` : log.changeQty}
                              </span>
                            </td>
                            <td>
                              <span className="font-mono text-white">{log.newStock}</span>
                            </td>
                            <td>
                              <span className={`log-type-tag type-${log.type}`}>
                                {log.type}
                              </span>
                            </td>
                            <td className="text-muted text-sm">
                              {log.reason}
                            </td>
                            <td>
                              <span className="staff-actor-badge">👤 {log.updatedBy}</span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Size-Aware Bulk Stock Import Modal */}
      {showBulkModal && (
        <div className="as-modal-backdrop" onClick={() => { setShowBulkModal(false); setImportFile(null); setBulkInput(""); }}>
          <div className="as-modal as-modal-wide" onClick={(e) => e.stopPropagation()}>
            <button className="as-modal-close" onClick={() => { setShowBulkModal(false); setImportFile(null); setBulkInput(""); }}>×</button>
            <h3 className="as-modal-title">📥 Size-Aware Stock Import</h3>

            {/* Format guide */}
            <div className="as-import-info-box">
              <strong>📋 CSV Format (3 columns):</strong>
              <div className="as-import-code-block">
                <span style={{color:"#7dd3fc"}}>Product Name or ID</span>,{" "}
                <span style={{color:"#86efac"}}>Size</span>,{" "}
                <span style={{color:"#fcd34d"}}>New Stock</span><br />
                T-Shirt, S, 25<br />
                T-Shirt, M, 18<br />
                T-Shirt, L, 10<br />
                Jeans, -, 50 <span style={{opacity:0.6, fontSize:"0.8em"}}>(use - for products without sizes)</span>
              </div>
              <small style={{color:"#aaa", display:"block", marginTop:"6px"}}>
                💡 <strong>Tip:</strong> Click <em>Export CSV</em> to download current stock — edit it and re-import directly.
              </small>
            </div>

            {/* ── Mode 1: Upload .csv file ── */}
            <div className="as-import-section">
              <h5 className="as-import-section-title">📂 Upload .csv File</h5>
              <form onSubmit={handleFileImport}>
                <div className="as-modal-form-group">
                  <label className="as-file-label">
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="as-file-input-hidden"
                      onChange={(e) => setImportFile(e.target.files[0] || null)}
                    />
                    <span className="as-file-btn">📁 Choose CSV File</span>
                    {importFile && (
                      <span className="as-file-name">📄 {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)</span>
                    )}
                  </label>
                </div>
                <div className="as-modal-actions">
                  <button type="button" className="as-btn as-btn-secondary" onClick={() => { setShowBulkModal(false); setImportFile(null); }}>
                    Cancel
                  </button>
                  <button type="submit" className="as-btn as-btn-primary" disabled={!importFile || importing}>
                    {importing ? "⏳ Importing…" : "📂 Import File"}
                  </button>
                </div>
              </form>
            </div>

            <div className="as-import-divider"><span>— OR paste CSV text —</span></div>

            {/* ── Mode 2: Paste CSV text ── */}
            <div className="as-import-section">
              <h5 className="as-import-section-title">📋 Paste CSV Text</h5>
              <form onSubmit={handleBulkUpdate}>
                <div className="as-modal-form-group">
                  <textarea
                    className="as-modal-textarea"
                    rows={6}
                    placeholder={"Product Name, Size, Stock\nT-Shirt, S, 25\nT-Shirt, M, 18\nJeans, -, 50"}
                    value={bulkInput}
                    onChange={(e) => setBulkInput(e.target.value)}
                  />
                </div>
                <div className="as-modal-actions">
                  <button type="button" className="as-btn as-btn-secondary" onClick={() => { setShowBulkModal(false); setBulkInput(""); }}>
                    Cancel
                  </button>
                  <button type="submit" className="as-btn as-btn-primary" disabled={!bulkInput.trim() || importing}>
                    {importing ? "⏳ Processing…" : "⚡ Process Import"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default AdminStock;
