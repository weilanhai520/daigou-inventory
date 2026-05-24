const STORE_KEY = "daigou_inventory_v2";
const AUTH_KEY = "daigou_admin_authenticated";
const ADMIN_PASSWORD = "admin123";
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="12" fill="#e8eee9"/><path d="M24 50h32l-8-11-7 8-5-6-12 9Z" fill="#9aaca2"/><circle cx="31" cy="29" r="5" fill="#9aaca2"/></svg>'
  );

const state = loadState();
let currentPhoto = "";
let cameraStream = null;
let isAdmin = sessionStorage.getItem(AUTH_KEY) === "true";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  pageTitle: $("#page-title"),
  pageSubtitle: $("#page-subtitle"),
  roleLabel: $("#role-label"),
  tabs: $$(".tab-button"),
  panels: $$(".tab-panel"),
  productGrid: $("#product-grid"),
  stockBody: $("#stock-body"),
  stockEmpty: $("#stock-empty"),
  recordsList: $("#records-list"),
  recordsEmpty: $("#records-empty"),
  search: $("#search"),
  sortStock: $("#sort-stock"),
  recordFilter: $("#record-filter"),
  outItem: $("#out-item"),
  photoPreview: $("#photo-preview"),
  cameraPreview: $("#camera-preview"),
  cameraCanvas: $("#camera-canvas"),
  photoHint: $("#photo-hint"),
  adminDialog: $("#admin-dialog"),
  adminPassword: $("#admin-password"),
  adminMessage: $("#admin-message"),
  metrics: {
    qty: $("#metric-qty"),
    kinds: $("#metric-kinds"),
    cost: $("#metric-cost"),
    realized: $("#metric-realized"),
    sideCost: $("#side-cost"),
    sideProfit: $("#side-profit"),
  },
};

const titles = {
  stock: ["在库商品", "查看当前可售商品、照片、库存和价格。"],
  inbound: ["新增入库", "录入采购商品，可保存照片和条码。"],
  outbound: ["商品出库", "选择在库商品，记录销售价格和客户。"],
  records: ["流水明细", "按时间查看每一笔入库和出库。"],
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function number(value) {
  return Number(value || 0);
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem("daigou_inventory_v1");
    if (raw) return JSON.parse(raw);
  } catch (error) {
    console.warn(error);
  }
  return { items: [], records: [] };
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function findItem(id) {
  return state.items.find((item) => item.id === id);
}

function itemLabel(item) {
  const sku = item.sku ? ` / ${item.sku}` : "";
  return `${item.name}${sku}`;
}

function getVisibleItems() {
  const keyword = els.search.value.trim().toLowerCase();
  const sort = els.sortStock.value;
  let items = state.items.filter((item) => {
    const haystack = `${item.name} ${item.sku} ${item.note}`.toLowerCase();
    return item.qty > 0 && haystack.includes(keyword);
  });

  return items.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "zh-CN");
    if (sort === "qty") return b.qty - a.qty;
    if (sort === "price") return b.sellPrice - a.sellPrice;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}

function totals() {
  const stocked = state.items.filter((item) => item.qty > 0);
  const stock = stocked.reduce(
    (acc, item) => {
      acc.qty += item.qty;
      acc.cost += item.qty * item.buyPrice;
      acc.value += item.qty * item.sellPrice;
      acc.profit += item.qty * (item.sellPrice - item.buyPrice);
      return acc;
    },
    { qty: 0, cost: 0, value: 0, profit: 0 }
  );

  const realized = state.records
    .filter((record) => record.type === "out")
    .reduce((sum, record) => sum + record.qty * (record.price - record.buyPrice), 0);

  return { ...stock, kinds: stocked.length, realized };
}

function renderMetrics() {
  const data = totals();
  els.metrics.qty.textContent = data.qty;
  els.metrics.kinds.textContent = data.kinds;
  els.metrics.cost.textContent = money(data.cost);
  els.metrics.realized.textContent = money(data.realized);
  els.metrics.sideCost.textContent = money(data.cost);
  els.metrics.sideProfit.textContent = money(data.profit);
}

function renderProducts() {
  const items = getVisibleItems();
  els.productGrid.innerHTML = "";

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <img alt="" src="${item.photo || PLACEHOLDER_IMAGE}">
      <div class="product-card-body">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.sku || "无编号")}</p>
        </div>
        <div class="product-card-meta">
          <span>库存 ${item.qty}</span>
          <strong>${money(item.sellPrice)}</strong>
        </div>
        ${
          isAdmin
            ? `<button class="ghost-button small-button delete-item" type="button" data-id="${item.id}">删除商品</button>`
            : ""
        }
      </div>
    `;
    els.productGrid.appendChild(card);
  }
}

function renderStockTable() {
  const items = getVisibleItems();
  els.stockBody.innerHTML = "";

  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="product-cell">
          <img class="thumb" alt="" src="${item.photo || PLACEHOLDER_IMAGE}">
          <div class="product-meta">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${escapeHtml(item.sku || "无编号")}</small>
          </div>
        </div>
      </td>
      <td>${item.qty}</td>
      <td>${money(item.buyPrice)}</td>
      <td>${money(item.sellPrice)}</td>
      <td>${money(item.qty * item.buyPrice)}</td>
      <td>${money(item.qty * item.sellPrice)}</td>
      <td>${money(item.qty * (item.sellPrice - item.buyPrice))}</td>
    `;
    els.stockBody.appendChild(tr);
  }

  els.stockEmpty.classList.toggle("active", items.length === 0);
}

function renderOutboundOptions() {
  els.outItem.innerHTML = "";
  const stocked = state.items.filter((item) => item.qty > 0);
  if (stocked.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无在库商品";
    els.outItem.appendChild(option);
    return;
  }

  for (const item of stocked) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${itemLabel(item)}，库存 ${item.qty}`;
    els.outItem.appendChild(option);
  }
  updateOutboundPreview();
}

function renderRecords() {
  const filter = els.recordFilter.value;
  const records = state.records
    .filter((record) => filter === "all" || record.type === filter)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  els.recordsList.innerHTML = "";
  const template = $("#record-template");
  for (const record of records) {
    const node = template.content.firstElementChild.cloneNode(true);
    const img = node.querySelector("img");
    const title = node.querySelector("strong");
    const tag = node.querySelector("span");
    const detail = node.querySelector("p");
    img.src = record.photo || PLACEHOLDER_IMAGE;
    title.textContent = record.name;
    tag.className = record.type === "in" ? "badge-in" : "badge-out";
    tag.textContent = record.type === "in" ? "入库" : "出库";
    const priceText =
      record.type === "in" ? `买入 ${money(record.buyPrice)} / 卖出 ${money(record.sellPrice)}` : `成交 ${money(record.price)}`;
    const customer = record.customer ? `，客户：${record.customer}` : "";
    const note = record.note ? `，备注：${record.note}` : "";
    detail.textContent = `${record.date}，数量 ${record.qty}，${priceText}，合计 ${money(record.total)}${customer}${note}`;
    els.recordsList.appendChild(node);
  }
  els.recordsEmpty.classList.toggle("active", records.length === 0);
}

function renderAuth() {
  document.body.classList.toggle("is-admin", isAdmin);
  els.roleLabel.textContent = isAdmin ? "管理员模式" : "访客查看";
  $("#admin-entry").hidden = isAdmin;

  if (!isAdmin) {
    const activeAdminTab = $(".tab-panel.active.admin-only");
    if (activeAdminTab) setTab("stock");
  }
}

function renderAll() {
  renderAuth();
  renderMetrics();
  renderProducts();
  renderStockTable();
  renderOutboundOptions();
  renderRecords();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function setTab(tab) {
  if (!isAdmin && tab !== "stock") return;
  els.tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.id === `${tab}-panel`));
  els.pageTitle.textContent = titles[tab][0];
  els.pageSubtitle.textContent = titles[tab][1];
}

function updateInboundPreview() {
  const qty = number($("#in-qty").value);
  const buy = number($("#in-buy").value);
  const sell = number($("#in-sell").value);
  $("#in-cost-preview").textContent = money(qty * buy);
  $("#in-value-preview").textContent = money(qty * sell);
}

function updateOutboundPreview() {
  const item = findItem(els.outItem.value);
  const qty = number($("#out-qty").value);
  const price = number($("#out-price").value || item?.sellPrice || 0);
  if (item && !$("#out-price").value) $("#out-price").value = item.sellPrice;
  $("#out-value-preview").textContent = money(qty * price);
  $("#out-profit-preview").textContent = money(item ? qty * (price - item.buyPrice) : 0);
}

function addInbound(event) {
  event.preventDefault();
  if (!isAdmin) return;

  const name = $("#in-name").value.trim();
  const sku = $("#in-sku").value.trim();
  const qty = number($("#in-qty").value);
  const buyPrice = number($("#in-buy").value);
  const sellPrice = number($("#in-sell").value);
  const date = $("#in-date").value;
  const note = $("#in-note").value.trim();
  const now = new Date().toISOString();

  const existing = state.items.find(
    (item) => item.name.trim().toLowerCase() === name.toLowerCase() && (item.sku || "") === sku
  );

  let item = existing;
  if (item) {
    const totalQty = item.qty + qty;
    item.buyPrice = (item.buyPrice * item.qty + buyPrice * qty) / totalQty;
    item.sellPrice = sellPrice;
    item.qty = totalQty;
    item.photo = currentPhoto || item.photo;
    item.note = note || item.note;
    item.updatedAt = now;
  } else {
    item = {
      id: uid(),
      name,
      sku,
      qty,
      buyPrice,
      sellPrice,
      photo: currentPhoto,
      note,
      createdAt: now,
      updatedAt: now,
    };
    state.items.push(item);
  }

  state.records.push({
    id: uid(),
    type: "in",
    itemId: item.id,
    name,
    sku,
    qty,
    buyPrice,
    sellPrice,
    total: qty * buyPrice,
    photo: currentPhoto || item.photo,
    note,
    date,
    createdAt: now,
  });

  saveState();
  event.target.reset();
  $("#in-date").value = today();
  $("#in-qty").value = 1;
  currentPhoto = "";
  showPhoto("");
  updateInboundPreview();
  renderAll();
  setTab("stock");
}

function addOutbound(event) {
  event.preventDefault();
  if (!isAdmin) return;

  const item = findItem(els.outItem.value);
  const qty = number($("#out-qty").value);
  if (!item || qty > item.qty) {
    alert("出库数量不能超过当前库存。");
    return;
  }

  const price = number($("#out-price").value);
  const date = $("#out-date").value;
  const customer = $("#out-customer").value.trim();
  const note = $("#out-note").value.trim();
  const now = new Date().toISOString();

  item.qty -= qty;
  item.updatedAt = now;
  state.records.push({
    id: uid(),
    type: "out",
    itemId: item.id,
    name: item.name,
    sku: item.sku,
    qty,
    buyPrice: item.buyPrice,
    price,
    total: qty * price,
    photo: item.photo,
    customer,
    note,
    date,
    createdAt: now,
  });

  saveState();
  event.target.reset();
  $("#out-date").value = today();
  $("#out-qty").value = 1;
  renderAll();
  setTab("records");
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("当前浏览器不支持拍照，请使用上传图片。");
    return;
  }
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  els.cameraPreview.srcObject = cameraStream;
  await els.cameraPreview.play();
  els.cameraPreview.classList.add("active");
  els.photoPreview.classList.remove("active");
  $("#take-photo").disabled = false;
}

function takePhoto() {
  if (!cameraStream) return;
  const video = els.cameraPreview;
  const canvas = els.cameraCanvas;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  currentPhoto = canvas.toDataURL("image/jpeg", 0.82);
  showPhoto(currentPhoto);
  cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  $("#take-photo").disabled = true;
}

function showPhoto(src) {
  els.photoPreview.src = src || "";
  els.photoPreview.classList.toggle("active", Boolean(src));
  els.cameraPreview.classList.remove("active");
}

function uploadPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    currentPhoto = reader.result;
    showPhoto(currentPhoto);
  };
  reader.readAsDataURL(file);
}

async function readBarcode() {
  if (!currentPhoto) {
    alert("请先拍照或上传一张图片。");
    return;
  }
  if (!("BarcodeDetector" in window)) {
    alert("这个浏览器暂不支持条码识别。照片已保存，可以手动填写商品名。");
    return;
  }
  const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "qr_code"] });
  const img = new Image();
  img.src = currentPhoto;
  await img.decode();
  const codes = await detector.detect(img);
  if (codes.length) {
    $("#in-sku").value = codes[0].rawValue;
    els.photoHint.textContent = "已识别条码并填入商品编号。";
  } else {
    alert("没有识别到条码，可以换一张更清晰的照片。");
  }
}

function exportCsv() {
  const rows = [
    ["类型", "日期", "商品名", "编号", "数量", "买入价", "卖出/成交价", "合计", "客户", "备注"],
    ...state.records.map((record) => [
      record.type === "in" ? "入库" : "出库",
      record.date,
      record.name,
      record.sku || "",
      record.qty,
      record.buyPrice || "",
      record.sellPrice || record.price || "",
      record.total,
      record.customer || "",
      record.note || "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `代购库存明细-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function clearData() {
  if (!isAdmin) return;
  if (!confirm("确定清空全部商品和流水吗？这个操作不能撤销。")) return;
  state.items = [];
  state.records = [];
  saveState();
  renderAll();
  setTab("stock");
}

function deleteItem(itemId) {
  if (!isAdmin) return;
  const item = findItem(itemId);
  if (!item) return;
  if (!confirm(`确定删除“${item.name}”吗？相关流水也会一起删除。`)) return;
  state.items = state.items.filter((entry) => entry.id !== itemId);
  state.records = state.records.filter((record) => record.itemId !== itemId);
  saveState();
  renderAll();
}

function openAdminDialog() {
  els.adminMessage.textContent = "";
  els.adminPassword.value = "";
  els.adminDialog.showModal();
  els.adminPassword.focus();
}

function loginAdmin(event) {
  event.preventDefault();
  if (els.adminPassword.value !== ADMIN_PASSWORD) {
    els.adminMessage.textContent = "密码不正确，请重新输入。";
    return;
  }
  isAdmin = true;
  sessionStorage.setItem(AUTH_KEY, "true");
  els.adminDialog.close();
  renderAll();
  setTab("stock");
}

function logoutAdmin() {
  isAdmin = false;
  sessionStorage.removeItem(AUTH_KEY);
  renderAll();
  setTab("stock");
}

function bindEvents() {
  els.tabs.forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  els.search.addEventListener("input", () => {
    renderProducts();
    renderStockTable();
  });
  els.productGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".delete-item");
    if (button) deleteItem(button.dataset.id);
  });
  els.sortStock.addEventListener("change", () => {
    renderProducts();
    renderStockTable();
  });
  els.recordFilter.addEventListener("change", renderRecords);
  $("#inbound-form").addEventListener("submit", addInbound);
  $("#outbound-form").addEventListener("submit", addOutbound);
  ["#in-qty", "#in-buy", "#in-sell"].forEach((id) => $(id).addEventListener("input", updateInboundPreview));
  ["#out-qty", "#out-price", "#out-item"].forEach((id) => $(id).addEventListener("input", updateOutboundPreview));
  $("#start-camera").addEventListener("click", startCamera);
  $("#take-photo").addEventListener("click", takePhoto);
  $("#photo-upload").addEventListener("change", uploadPhoto);
  $("#read-code").addEventListener("click", readBarcode);
  $("#export-csv").addEventListener("click", exportCsv);
  $("#clear-data").addEventListener("click", clearData);
  $("#admin-entry").addEventListener("click", openAdminDialog);
  $("#admin-form").addEventListener("submit", loginAdmin);
  $("#close-admin").addEventListener("click", () => els.adminDialog.close());
  $("#logout-admin").addEventListener("click", logoutAdmin);
}

$("#in-date").value = today();
$("#out-date").value = today();
bindEvents();
updateInboundPreview();
renderAll();
