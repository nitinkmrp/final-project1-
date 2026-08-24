import { useEffect, useState, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, NavLink } from "react-router-dom";
import { toast } from "react-toastify";
import { fetchCategories } from "../app/categorySlice";
import "./AdminProducts.css";

const BASE_URL = process.env.REACT_APP_API_URL || "https://final-project1-d3iz.onrender.com";

const EMPTY_FORM = {
  productName: "", category: "", sizes: "", price: "", discount: "0",
  stock: "0", sizeStock: {}, shortDesc: "", description: "", imgUrl: "", avgRating: "4.5",
};

const AdminProducts = () => {
  const dispatch    = useDispatch();
  const navigate    = useNavigate();
  const currentUser = useSelector((s) => s.users.currentUser);
  const { categories: dbCategories } = useSelector((s) => s.categories);

  // Build category name list from DB; fall back to slugs already on products
  const categoryNames = dbCategories
    .filter((c) => c.isActive)
    .map((c) => c.name);

  const [products, setProducts]         = useState([]);
  const [loading, setLoading]           = useState(false);
  const [search, setSearch]             = useState("");
  const [catFilter, setCatFilter]       = useState("all");
  const [showForm, setShowForm]         = useState(false);
  const [editTarget, setEditTarget]     = useState(null);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [imageFile, setImageFile]       = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving]             = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [aiLoading, setAiLoading]       = useState(false); // OpenRouter AI
  const [aiImgLoading, setAiImgLoading] = useState(false); // Gemini + Adobe AI
  const [ccEverywhere, setCcEverywhere] = useState(null);
  const fileInputRef = useRef();

  // Load Adobe Express Embed SDK
  useEffect(() => {
    const clientId = process.env.REACT_APP_ADOBE_CLIENT_ID;
    if (!clientId) {
      console.warn("REACT_APP_ADOBE_CLIENT_ID is missing. Adobe Express Embed SDK will not initialize.");
      return;
    }
    // Guard: prevent double-init from React StrictMode or HMR
    if (window.__adobeSdkInitializing || window.__adobeSdkReady) return;
    window.__adobeSdkInitializing = true;

    const initAdobeSdk = async () => {
      try {
        if (window.__adobeSdkReady) return;
        const cc = await window.CCEverywhere.initialize({ clientId, appName: "AdminPortal" });
        setCcEverywhere(cc);
        window.__adobeSdkReady = true;
      } catch (err) {
        console.error("Failed to load Adobe Express Embed SDK:", err);
      } finally {
        window.__adobeSdkInitializing = false;
      }
    };

    if (window.CCEverywhere) {
      initAdobeSdk();
    } else {
      if (!document.getElementById("adobe-cc-sdk")) {
        const script = document.createElement("script");
        script.id    = "adobe-cc-sdk";
        script.src   = "https://cc-embed.adobe.com/sdk/v4/CCEverywhere.js";
        script.async = true;
        script.onload  = initAdobeSdk;
        script.onerror = () => { window.__adobeSdkInitializing = false; };
        document.body.appendChild(script);
      }
    }
  }, []);


  useEffect(() => { if (!currentUser) navigate("/"); }, [currentUser, navigate]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${BASE_URL}/api/products`);
      const data = await res.json();
      if (data.success) setProducts(data.data);
    } catch { toast.error("Failed to load products"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchProducts();
    dispatch(fetchCategories());   // always pull latest categories
  }, [dispatch]);

  // Derive unique category values that exist on products (as fallback)
  const productCats = [...new Set(products.map((p) => p.category).filter(Boolean))];
  // Final list: prefer DB categories, fallback to whatever is on products
  const allCategoryNames = categoryNames.length > 0 ? categoryNames : productCats;

  // ── OpenRouter AI Description Generator ─────────────────
  const generateDescriptions = async (target = "both") => {
    if (!form.productName.trim()) {
      toast.error("Please enter a product name first");
      return;
    }
    setAiLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/ai/describe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("jwtToken")}`,
        },
        body: JSON.stringify({
          productName: form.productName,
          category:    form.category,
          price:       form.price,
          target,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        toast.error(`AI error: ${data.message}`);
        return;
      }

      if (target === "both") {
        setForm((prev) => ({
          ...prev,
          shortDesc:   data.short || prev.shortDesc,
          description: data.full  || prev.description,
        }));
        toast.success("✨ AI generated both descriptions!");
      } else if (target === "short") {
        setForm((prev) => ({ ...prev, shortDesc: data.short }));
        toast.success("✨ Short description generated!");
      } else {
        setForm((prev) => ({ ...prev, description: data.full }));
        toast.success("✨ Full description generated!");
      }
    } catch (err) {
      toast.error(`AI error: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const generateImage = async () => {
    if (!form.productName.trim()) {
      toast.error("Please enter a product name first");
      return;
    }

    if (!ccEverywhere) {
      toast.error("Adobe Express Embed SDK is not initialized. Check your Client ID.");
      return;
    }

    setAiImgLoading(true);
    try {
      // Bypass OpenRouter API entirely to avoid credit limits. 
      // Construct a high-quality prompt directly from the product name and category.
      const generatedPrompt = `Professional studio product photography shot of ${form.productName} ${form.category ? `(${form.category})` : ''}, clean background, 4k resolution, highly detailed.`;
      
      toast.success("✨ Opening Adobe Express...");
      setAiImgLoading(false); // Done with our own loading, Adobe UI will open

      // 2. Open Adobe Express Embed SDK to generate and edit the image
      const appConfig = {
        appVersion: "2",
        promptText: generatedPrompt,
        callbacks: {
          onPublish: (intent, publishParams) => {
            // The user hit save/publish in Adobe Express
            const localUrl = publishParams?.asset?.[0]?.data;
            
            if (!localUrl) {
              toast.error("No image was returned from Adobe Express.");
              return;
            }

            // Note: Adobe passes back a blob URL or base64. 
            // We set it as the preview, and we need to fetch it to convert to a File object for the form.
            setImagePreview(localUrl);
            
            fetch(localUrl)
              .then(res => res.blob())
              .then(blob => {
                const file = new File([blob], `adobe-express-product.png`, { type: blob.type });
                setImageFile(file);
                setForm((prev) => ({ ...prev, imgUrl: "" })); // Clear any URL if they had one
                toast.success("Image saved from Adobe Express!");
              })
              .catch(() => {
                toast.error("Failed to process the image from Adobe Express.");
              });
          },
          onError: (err) => {
            console.error("Adobe Express Error:", err);
            toast.error("An error occurred with Adobe Express");
          }
        }
      };

      ccEverywhere.module.createImageFromText(appConfig);
      
    } catch (err) {
      toast.error(`AI Image Error: ${err.message}`);
      setAiImgLoading(false);
    }
  };

  // Filtered list
  const filtered = products.filter((p) => {
    const matchCat    = catFilter === "all" || p.category === catFilter;
    const matchSearch = p.productName.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  // ── Stats ────────────────────────────────────────────
  const totalStock = products.reduce((s, p) => s + (p.stock || 0), 0);
  const outOfStock = products.filter((p) => (p.stock || 0) === 0).length;
  const lowStock   = products.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= 5).length;

  // ── Form helpers ─────────────────────────────────────
  const openCreate = () => {
    setForm({ ...EMPTY_FORM, category: allCategoryNames[0] || "" });
    setEditTarget(null);
    setImageFile(null);
    setImagePreview(null);
    setShowForm(true);
  };

  const openEdit = (p) => {
    // Reconstruct sizeStock from product data (may be a Map object from Mongoose)
    let ss = {};
    if (p.sizeStock) {
      if (p.sizeStock instanceof Map) {
        p.sizeStock.forEach((v, k) => { ss[k] = v; });
      } else {
        ss = { ...p.sizeStock };
      }
    }
    setForm({
      productName: p.productName, category: p.category,
      sizes: p.sizes ? p.sizes.join(", ") : "",
      sizeStock: ss,
      price: p.price, discount: p.discount || 0,
      stock: p.stock || 0, shortDesc: p.shortDesc || "",
      description: p.description || "", imgUrl: p.imgUrl || "",
      avgRating: p.avgRating || 0,
    });
    setImageFile(null);
    setImagePreview(p.imgUrl || null);
    setEditTarget(p);
    setShowForm(true);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.productName || !form.category || !form.price) {
      toast.error("Name, category and price are required");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      // Append all form fields except sizeStock (handled separately)
      Object.entries(form).forEach(([k, v]) => {
        if (k !== "sizeStock") fd.append(k, v);
      });
      // Append sizeStock as JSON
      if (form.sizeStock && Object.keys(form.sizeStock).length > 0) {
        fd.append("sizeStock", JSON.stringify(form.sizeStock));
      }
      if (imageFile) fd.append("image", imageFile);

      const headers = {};
      const token = localStorage.getItem("jwtToken");
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const url    = editTarget ? `${BASE_URL}/api/products/${editTarget._id}` : `${BASE_URL}/api/products`;
      const method = editTarget ? "PUT" : "POST";
      const res    = await fetch(url, { method, body: fd, headers });
      const data   = await res.json();

      if (data.success) {
        toast.success(editTarget ? "Product updated!" : "Product created!");
        setShowForm(false);
        setEditTarget(null);
        fetchProducts();
      } else {
        toast.error(data.message || "Failed to save product");
      }
    } catch { toast.error("Network error"); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const headers = {};
      const token = localStorage.getItem("jwtToken");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      
      const res  = await fetch(`${BASE_URL}/api/products/${deleteTarget._id}`, {
        method: "DELETE",
        headers,
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Product deleted");
        setProducts((prev) => prev.filter((p) => p._id !== deleteTarget._id));
      } else {
        toast.error(data.message || "Failed to delete");
      }
    } catch { toast.error("Network error"); }
    finally { setDeleteTarget(null); }
  };

  // Inline stock update
  const handleStockChange = async (id, newStock) => {
    if (newStock < 0) return;
    try {
      const headers = { "Content-Type": "application/json" };
      const token = localStorage.getItem("jwtToken");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      
      const res  = await fetch(`${BASE_URL}/api/products/${id}/stock`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ stock: newStock }),
      });
      const data = await res.json();
      if (data.success) {
        setProducts((prev) => prev.map((p) => p._id === id ? { ...p, stock: data.data.stock } : p));
        toast.success("Stock updated");
      }
    } catch { toast.error("Failed to update stock"); }
  };

  const stockBadge = (stock) => {
    if (stock === 0)    return <span className="ap-badge ap-badge-out">Out of Stock</span>;
    if (stock <= 5)     return <span className="ap-badge ap-badge-low">Low Stock</span>;
    return                     <span className="ap-badge ap-badge-ok">In Stock</span>;
  };

  const imgSrc = (p) => p.imgUrl || null;

  if (!currentUser) return null;

  return (
    <section className="ap-page">
      <div className="container-fluid px-4 py-4">

        {/* ── Admin Nav Tabs ── */}
        <div className="ap-nav-tabs mb-4">
          <NavLink to="/admin/users"       className={({ isActive }) => `ap-nav-tab${isActive ? " active" : ""}`}>👥 Users</NavLink>
          <NavLink to="/admin/products"    className={({ isActive }) => `ap-nav-tab${isActive ? " active" : ""}`}>🛍️ Products</NavLink>
          <NavLink to="/admin/categories"  className={({ isActive }) => `ap-nav-tab${isActive ? " active" : ""}`}>🗂️ Categories</NavLink>
          <NavLink to="/admin/bills"       className={({ isActive }) => `ap-nav-tab${isActive ? " active" : ""}`}>🧾 Bills</NavLink>
          <NavLink to="/admin/customers"   className={({ isActive }) => `ap-nav-tab${isActive ? " active" : ""}`}>👤 Customers</NavLink>
          <NavLink to="/admin/stock"       className={({ isActive }) => `ap-nav-tab${isActive ? " active" : ""}`}>📦 Stock</NavLink>
          <NavLink to="/admin/discounts"   className={({ isActive }) => `ap-nav-tab${isActive ? " active" : ""}`}>🏷️ Discounts</NavLink>
          <NavLink to="/admin/deliveries"  className={({ isActive }) => `ap-nav-tab${isActive ? " active" : ""}`}>🚚 Deliveries</NavLink>
        </div>

        {/* ── Header ── */}
        <div className="ap-header">
          <div>
            <h2 className="ap-title">Product Management</h2>
            <p className="ap-sub">{products.length} total products</p>
          </div>
          <button className="ap-add-btn" onClick={openCreate}>+ Add Product</button>
        </div>

        {/* ── Stats ── */}
        <div className="ap-stats">
          <div className="ap-stat-box">
            <div className="ap-stat-icon">📦</div>
            <div>
              <div className="ap-stat-num">{products.length}</div>
              <div className="ap-stat-lbl">Total Products</div>
            </div>
          </div>
          <div className="ap-stat-box">
            <div className="ap-stat-icon">✅</div>
            <div>
              <div className="ap-stat-num">{totalStock}</div>
              <div className="ap-stat-lbl">Total Stock Units</div>
            </div>
          </div>
          <div className="ap-stat-box ap-stat-warn">
            <div className="ap-stat-icon">⚠️</div>
            <div>
              <div className="ap-stat-num">{lowStock}</div>
              <div className="ap-stat-lbl">Low Stock (≤5)</div>
            </div>
          </div>
          <div className="ap-stat-box ap-stat-danger">
            <div className="ap-stat-icon">🚫</div>
            <div>
              <div className="ap-stat-num">{outOfStock}</div>
              <div className="ap-stat-lbl">Out of Stock</div>
            </div>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="ap-filters">
          <input
            className="ap-search"
            placeholder="🔍 Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="ap-cat-pills">
            {["all", ...allCategoryNames].map((c) => (
              <button
                key={c}
                className={`ap-cat-pill ${catFilter === c ? "active" : ""}`}
                onClick={() => setCatFilter(c)}
              >
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div className="text-center py-5">
            <div className="spinner-border" style={{ color: "#0f3460" }} />
          </div>
        ) : (
          <div className="ap-table-wrap">
            <table className="ap-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Discount</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Rating</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="ap-empty">No products found</td>
                  </tr>
                ) : (
                  filtered.map((p) => (
                    <tr key={p._id} className={(p.stock || 0) === 0 ? "ap-row-out" : (p.stock || 0) <= 5 ? "ap-row-low" : ""}>
                      <td>
                        <div className="ap-product-cell">
                          {imgSrc(p) ? (
                            <img src={imgSrc(p)} alt={p.productName} className="ap-thumb" />
                          ) : (
                            <div className="ap-thumb-placeholder">📦</div>
                          )}
                          <span className="ap-product-name">{p.productName}</span>
                        </div>
                      </td>
                      <td><span className="ap-cat-badge">{p.category}</span></td>
                      <td className="ap-price">₹{p.price}</td>
                      <td>{p.discount || 0}%</td>
                      <td>
                        <div className="ap-stock-ctrl">
                          <button className="ap-stock-btn" onClick={() => handleStockChange(p._id, (p.stock || 0) - 1)}>−</button>
                          <input
                            className="ap-stock-input"
                            type="number" min="0"
                            value={p.stock || 0}
                            onChange={(e) => setProducts((prev) =>
                              prev.map((x) => x._id === p._id ? { ...x, stock: Number(e.target.value) } : x)
                            )}
                            onBlur={(e) => handleStockChange(p._id, Number(e.target.value))}
                          />
                          <button className="ap-stock-btn" onClick={() => handleStockChange(p._id, (p.stock || 0) + 1)}>+</button>
                        </div>
                      </td>
                      <td>{stockBadge(p.stock || 0)}</td>
                      <td>⭐ {p.avgRating || 0}</td>
                      <td>
                        <div className="ap-actions">
                          <button className="ap-edit-btn" onClick={() => openEdit(p)}>✏️ Edit</button>
                          <button className="ap-del-btn" onClick={() => setDeleteTarget(p)}>🗑️ Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add / Edit Modal ── */}
      {showForm && (
        <div className="ap-modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="ap-modal" onClick={(e) => e.stopPropagation()}>
            <button className="ap-modal-close" onClick={() => setShowForm(false)}>×</button>
            <h5 className="ap-modal-title">{editTarget ? "✏️ Edit Product" : "➕ Add New Product"}</h5>

            <form onSubmit={handleSubmit}>
              {/* Image Upload */}
              <div className="ap-image-upload-area" onClick={() => fileInputRef.current?.click()}>
                {imagePreview ? (
                  <img src={imagePreview} alt="preview" className="ap-img-preview" />
                ) : (
                  <div className="ap-upload-placeholder">
                    <span className="ap-upload-icon">📷</span>
                    <span>Click to upload image</span>
                    <small>JPG, PNG, WebP — max 5MB</small>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleImageChange}
                />
              </div>
              
              <div className="ap-image-actions" style={{ display: 'flex', gap: '10px', marginTop: '10px', justifyContent: 'center' }}>
                <button 
                  type="button" 
                  className={`ai-gen-btn ${aiImgLoading ? "ai-gen-loading" : ""}`} 
                  onClick={generateImage}
                  disabled={aiImgLoading}
                  style={{ width: 'auto' }}
                >
                  {aiImgLoading ? (
                    <><span className="ai-spinner" /> Generating Image…</>
                  ) : (
                    <>✨ AI Generate Image</>
                  )}
                </button>
                
                {imagePreview && (
                  <button type="button" className="ap-clear-img" style={{ margin: 0 }} onClick={() => { setImageFile(null); setImagePreview(null); setForm({...form, imgUrl: ""}); }}>
                    Remove Image
                  </button>
                )}
              </div>

              {/* Or URL */}
              <div className="ap-form-group">
                <label>Image URL <span className="ap-hint">(optional if uploaded above)</span></label>
                <input
                  className="ap-input"
                  value={form.imgUrl}
                  onChange={(e) => { setForm({ ...form, imgUrl: e.target.value }); if (e.target.value) setImagePreview(e.target.value); }}
                  placeholder="https://example.com/product.jpg"
                />
              </div>

              {/* Two columns */}
              <div className="ap-form-row">
                <div className="ap-form-group">
                  <label>Product Name *</label>
                  <input className="ap-input" value={form.productName}
                    onChange={(e) => setForm({ ...form, productName: e.target.value })}
                    placeholder="e.g. Apple iPhone 15" />
                </div>
                <div className="ap-form-group">
                  <label>Category *</label>
                  <select className="ap-input" value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {allCategoryNames.length === 0 ? (
                      <option value="">No categories yet — add them first</option>
                    ) : (
                      allCategoryNames.map((c) => <option key={c} value={c}>{c}</option>)
                    )}
                  </select>
                </div>
              </div>

              <div className="ap-form-row">
                <div className="ap-form-group">
                  <label>Price (₹) *</label>
                  <input className="ap-input" type="number" min="0" value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0" />
                </div>
              </div>

              {/* ── Size toggle buttons ── */}
              <div className="ap-form-group">
                <label>Sizes <span className="ap-hint">(click to toggle)</span></label>
                <div className="ap-size-toggles">
                  {["XS","S","M","L","XL","XXL","XXXL"].map((sz) => {
                    const active = (form.sizes || "").split(",").map(s => s.trim()).includes(sz);
                    return (
                      <button
                        key={sz} type="button"
                        className={`ap-size-toggle ${active ? "active" : ""}`}
                        onClick={() => {
                          const cur = (form.sizes || "").split(",").map(s => s.trim()).filter(Boolean);
                          const next = active ? cur.filter(s => s !== sz) : [...cur, sz];
                          setForm({ ...form, sizes: next.join(", ") });
                        }}
                      >{sz}</button>
                    );
                  })}
                </div>
                <input
                  className="ap-input" style={{ marginTop: 8 }}
                  value={form.sizes}
                  onChange={(e) => setForm({ ...form, sizes: e.target.value })}
                  placeholder="Custom: 28, 30, 32 — or leave blank if above covers it"
                />
              </div>

              <div className="ap-form-row">
                <div className="ap-form-group">
                  <label>Discount (%)</label>
                  {/* Quick preset chips */}
                  <div className="ap-discount-presets">
                    {[0,5,10,15,20,25,30,40,50,70].map((d) => (
                      <button
                        key={d} type="button"
                        className={`ap-discount-chip ${Number(form.discount) === d ? "active" : ""}`}
                        onClick={() => setForm({ ...form, discount: String(d) })}
                      >
                        {d === 0 ? "No disc." : `${d}%`}
                      </button>
                    ))}
                  </div>
                  <input
                    className="ap-input" type="number" min="0" max="100"
                    value={form.discount}
                    onChange={(e) => setForm({ ...form, discount: e.target.value })}
                    placeholder="Custom %"
                    style={{ marginTop: 8 }}
                  />
                </div>

                {/* ── Stock section ── */}
                <div className="ap-form-group">
                  {(() => {
                    const activeSizes = (form.sizes || "")
                      .split(",").map(s => s.trim()).filter(Boolean);

                    if (activeSizes.length === 0) {
                      // No sizes → single total stock input
                      return (
                        <>
                          <label>Stock Units</label>
                          <input
                            className="ap-input" type="number" min="0"
                            value={form.stock}
                            onChange={(e) => setForm({ ...form, stock: e.target.value })}
                            placeholder="0"
                          />
                        </>
                      );
                    }

                    // Has sizes → per-size stock inputs
                    const sizeStock = form.sizeStock || {};
                    const total = activeSizes.reduce((s, sz) => s + Number(sizeStock[sz] || 0), 0);

                    return (
                      <>
                        <label>
                          Stock per Size
                          <span className="ap-hint" style={{ marginLeft: 8 }}>
                            Total: <strong>{total}</strong> units
                          </span>
                        </label>
                        <div className="ap-size-stock-grid">
                          {activeSizes.map((sz) => (
                            <div key={sz} className="ap-size-stock-item">
                              <span className="ap-size-stock-label">{sz}</span>
                              <input
                                type="number" min="0"
                                className="ap-size-stock-input"
                                value={sizeStock[sz] ?? ""}
                                placeholder="0"
                                onChange={(e) => {
                                  const val = Number(e.target.value) || 0;
                                  const next = { ...sizeStock, [sz]: val };
                                  const newTotal = activeSizes.reduce((s, s2) => s + Number(next[s2] || 0), 0);
                                  setForm({ ...form, sizeStock: next, stock: String(newTotal) });
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="ap-form-row">
                <div className="ap-form-group">
                  <label>Avg Rating (0–5)</label>
                  <input className="ap-input" type="number" min="0" max="5" step="0.1" value={form.avgRating}
                    onChange={(e) => setForm({ ...form, avgRating: e.target.value })} placeholder="4.5" />
                </div>
                <div className="ap-form-group"></div>
              </div>

              {/* AI Description Assistant */}
              <div className="ai-assistant-bar">
                <div className="ai-badge">✨ AI Assistant</div>
                <span className="ai-hint">Auto-write descriptions using Gemini AI</span>
                <button
                  type="button"
                  className={`ai-gen-btn ${aiLoading ? "ai-gen-loading" : ""}`}
                  onClick={() => generateDescriptions("both")}
                  disabled={aiLoading}
                  title="Generate both short and full description using Gemini AI"
                >
                  {aiLoading ? (
                    <><span className="ai-spinner" /> Generating…</>
                  ) : (
                    <>✨ Write Both</>
                  )}
                </button>
              </div>

              <div className="ap-form-group">
                <div className="ai-label-row">
                  <label>Short Description</label>
                  <button type="button" className="ai-mini-btn"
                    onClick={() => generateDescriptions("short")}
                    disabled={aiLoading}
                    title="Generate short description only">
                    ✨ AI
                  </button>
                </div>
                <input className="ap-input" value={form.shortDesc}
                  onChange={(e) => setForm({ ...form, shortDesc: e.target.value })}
                  placeholder="One-line summary…" />
              </div>

              <div className="ap-form-group">
                <div className="ai-label-row">
                  <label>Full Description</label>
                  <button type="button" className="ai-mini-btn"
                    onClick={() => generateDescriptions("full")}
                    disabled={aiLoading}
                    title="Generate full description only">
                    ✨ AI
                  </button>
                </div>
                <textarea className="ap-input ap-textarea" rows={3} value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Detailed product description…" />
              </div>

              <button type="submit" className="ap-submit-btn" disabled={saving}>
                {saving ? "Saving…" : editTarget ? "Update Product" : "Create Product"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteTarget && (
        <div className="ap-modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="ap-modal ap-modal-sm" onClick={(e) => e.stopPropagation()}>
            <h5 className="ap-modal-title">🗑️ Delete Product?</h5>
            <p className="ap-del-msg">
              <strong>{deleteTarget.productName}</strong> will be permanently removed.
            </p>
            <div className="ap-del-actions">
              <button className="ap-cancel-btn" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="ap-confirm-del-btn" onClick={handleDelete}>Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default AdminProducts;
