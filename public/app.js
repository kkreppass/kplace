let currentUser = null;
let pixelLimitPerHour = 100;
let usedPixelsThisHour = 0;

async function checkAuth() {
  try {
    const response = await fetch("/api/auth/me");
    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
      pixelLimitPerHour = Number(data.user?.pixelLimitPerHour || 100);
      usedPixelsThisHour = Number(data.user?.usedPixelsThisHour || 0);
      updateAuthUI();
      updatePaintButtonLabel();
      return true;
    } else {
      currentUser = null;
      usedPixelsThisHour = 0;
      updateAuthUI();
      updatePaintButtonLabel();
      return false;
    }
  } catch (error) {
    console.error("Auth check error:", error);
    currentUser = null;
    usedPixelsThisHour = 0;
    updateAuthUI();
    updatePaintButtonLabel();
    return false;
  }
}

function getUnsavedPixelCount() {
  let totalPixels = 0;
  for (const pixelMap of cellPixelChanges.values()) {
    totalPixels += pixelMap.size;
  }
  return totalPixels;
}

function getCurrentWindowTotalPixels() {
  return usedPixelsThisHour + getUnsavedPixelCount();
}

function canPlaceMorePixels() {
  return getCurrentWindowTotalPixels() < pixelLimitPerHour;
}

function updateAuthUI() {
  const userInfo = document.getElementById("userInfo");
  const authButtons = document.getElementById("authButtons");
  const usernameDisplay = document.getElementById("usernameDisplay");
  const emailDisplay = document.getElementById("emailDisplay");

  if (currentUser) {
    usernameDisplay.textContent = currentUser.username;
    if (emailDisplay) {
      emailDisplay.textContent = currentUser.email || "";
    }
    userInfo.classList.add("show");
    authButtons.classList.add("hide");
  } else {
    userInfo.classList.remove("show");
    authButtons.classList.remove("hide");
    if (emailDisplay) {
      emailDisplay.textContent = "";
    }
    if (usernameDisplay) {
      usernameDisplay.textContent = "";
    }
  }
}

document.getElementById("loginBtn").addEventListener("click", () => {
  document.getElementById("loginModal").classList.add("show");
  document.getElementById("loginError").classList.remove("show");
});

document.getElementById("loginCancelBtn").addEventListener("click", () => {
  document.getElementById("loginModal").classList.remove("show");
});

document
  .getElementById("loginSubmitBtn")
  .addEventListener("click", async () => {
    const email = document.getElementById("loginEmail").value + "@kaist.ac.kr";
    const password = document.getElementById("loginPassword").value;
    const errorEl = document.getElementById("loginError");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        await checkAuth();
        document.getElementById("loginModal").classList.remove("show");
        document.getElementById("loginEmail").value = "";
        document.getElementById("loginPassword").value = "";
      } else {
        errorEl.textContent = data.error || "로그인에 실패했습니다";
        errorEl.classList.add("show");
      }
    } catch (error) {
      console.error("Login error:", error);
      errorEl.textContent = "로그인에 실패했습니다";
      errorEl.classList.add("show");
    }
  });

document
  .getElementById("loginToRegisterLink")
  .addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("loginModal").classList.remove("show");
    document.getElementById("registerModal").classList.add("show");
    document.getElementById("registerError").classList.remove("show");
    document.getElementById("registerSuccess").classList.remove("show");
  });

document.getElementById("registerCancelBtn").addEventListener("click", () => {
  document.getElementById("registerModal").classList.remove("show");
});

document
  .getElementById("registerSubmitBtn")
  .addEventListener("click", async () => {
    const username = document.getElementById("registerUsername").value;
    const email =
      document.getElementById("registerEmail").value + "@kaist.ac.kr";
    const password = document.getElementById("registerPassword").value;
    const errorEl = document.getElementById("registerError");
    const successEl = document.getElementById("registerSuccess");

    errorEl.classList.remove("show");
    successEl.classList.remove("show");

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.emailPreviewUrl) {
          successEl.innerHTML = `
        ${data.message}<br><br>
        <small>테스트용 이메일 미리보기: <a href="${data.emailPreviewUrl}" target="_blank">이메일 보기</a></small>
      `;
        } else {
          successEl.textContent = data.message;
        }
        successEl.classList.add("show");
        document.getElementById("registerUsername").value = "";
        document.getElementById("registerEmail").value = "";
        document.getElementById("registerPassword").value = "";
      } else {
        errorEl.textContent = data.error || "회원가입에 실패했습니다";
        errorEl.classList.add("show");
      }
    } catch (error) {
      console.error("Register error:", error);
      errorEl.textContent = "회원가입에 실패했습니다";
      errorEl.classList.add("show");
    }
  });

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
    });

    if (response.ok) {
      currentUser = null;
      usedPixelsThisHour = 0;
      updateAuthUI();
      updatePaintButtonLabel();
      document.getElementById("profileMenu").classList.remove("open");
    }
  } catch (error) {
    console.error("Logout error:", error);
  }
});

const profileBtn = document.getElementById("profileBtn");
const profileMenu = document.getElementById("profileMenu");

profileBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  profileMenu.classList.toggle("open");
});

document.addEventListener("click", (e) => {
  if (!profileBtn.contains(e.target) && !profileMenu.contains(e.target)) {
    profileMenu.classList.remove("open");
  }
});

checkAuth();

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const map = new maplibregl.Map({
  container: "map",
  style: MAP_STYLE_URL,
  center: [127.365, 36.37],
  zoom: 19,
  minZoom: 15,
  maxZoom: 22,
  pitch: 0,
  pitchWithRotate: false,
  dragRotate: false,
  touchPitch: false,
  attributionControl: false,
});

map.touchZoomRotate.disableRotation();

let selectedAreaType = null;
let selectedAreaBounds = null;
let selectedAreaPolygonPoints = [];

const gridCellById = new Map();
const GRID_SIZE_METERS = 100;
const GRID_IMAGE_SIZE = 64;

const visibleOverlayByCellId = new Map();
const modifiedPixelHighlights = new Map();
const cellImageCanvasById = new Map();
const dirtyCellIds = new Set();
const imageVersionByCellId = new Map();
const cellPixelChanges = new Map();

let activeCellId = null;
let mapReady = false;
const VISIBLE_IMAGE_REFRESH_INTERVAL_MS = 10000;
const VISIBLE_IMAGE_REFRESH_MIN_ZOOM = 16;
let visibleImageRefreshIntervalId = null;
let isPeriodicVisibleImageRefreshRunning = false;

const PALETTE_COLORS = [
  "#000000",
  "#3C3C3C",
  "#787878",
  "#ffffff",
  "#600018",
  "#EC1D23",
  "#FF7F26",
  "#F6AB09",
  "#F9DD3B",
  "#FFFABC",
  "#11E67B",
  "#87FF5F",
  "#0CB968",
  "#0A816E",
  "#0DAEA6",
  "#12E1BE",
  "#28509E",
  "#4193E4",
  "#60F7F2",
  "#6B50F6",
  "#9AB1FB",
  "#780C99",
  "#AA38B9",
  "#E09FF9",
  "#CB007B",
  "#F38DA9",
  "#694634",
  "#95682A",
  "#F8B276",
  "TRANSPARENT",
];

let currentPixelColor = PALETTE_COLORS[0];
let isPaintModeActive = false;
let isSpacePressed = false;
let isMouseDown = false;
let isLayerOpacityEnabled = false;
let isEraseMode = false;
const paintBtn = document.getElementById("paintBtn");
const currentLocationBtn = document.getElementById("currentLocationBtn");
let currentLocationMarker = null;

const pixelHighlight = (() => {
  const el = document.createElement("img");
  el.id = "pixelHighlight";
  el.src = "/src/highlight.png";
  el.style.position = "absolute";
  el.style.width = "1px";
  el.style.height = "1px";
  el.style.pointerEvents = "none";
  el.style.display = "none";
  el.style.zIndex = "3";
  el.style.imageRendering = "pixelated";
  el.style.opacity = "1";
  return el;
})();

const overlayContainer = (() => {
  const el = document.createElement("div");
  el.id = "cellOverlayContainer";
  el.style.position = "absolute";
  el.style.top = "0";
  el.style.left = "0";
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.pointerEvents = "none";
  el.style.overflow = "hidden";
  el.style.zIndex = "1";
  const mapContainer = document.getElementById("map");
  mapContainer.appendChild(el);
  el.appendChild(pixelHighlight);
  return el;
})();

function createBlankCellCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = GRID_IMAGE_SIZE;
  canvas.height = GRID_IMAGE_SIZE;
  return canvas;
}

function getCellImageRequestUrl(cellId) {
  const version = imageVersionByCellId.get(cellId) || 0;
  return `/api/grid-images/${encodeURIComponent(cellId)}?v=${version}`;
}

function loadImageIntoCanvas(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = createBlankCellCanvas();
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, GRID_IMAGE_SIZE, GRID_IMAGE_SIZE);
      context.drawImage(image, 0, 0, GRID_IMAGE_SIZE, GRID_IMAGE_SIZE);
      resolve(canvas);
    };
    image.onerror = () => {
      resolve(createBlankCellCanvas());
    };
    image.src = url;
  });
}

async function getCellCanvas(cellId) {
  if (cellImageCanvasById.has(cellId)) {
    return cellImageCanvasById.get(cellId);
  }

  const loadedCanvas = await loadImageIntoCanvas(
    getCellImageRequestUrl(cellId),
  );
  cellImageCanvasById.set(cellId, loadedCanvas);
  return loadedCanvas;
}

function metersToLatDegrees(meters) {
  return meters / 111320;
}

function metersToLngDegrees(meters, lat) {
  const cos = Math.cos((lat * Math.PI) / 180);
  return meters / (111320 * Math.max(cos, 0.00001));
}

function getCellBoundsFromCorners(corners) {
  const lats = corners.map((point) => point[0]);
  const lngs = corners.map((point) => point[1]);
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
  };
}

function boundsIntersect(a, b) {
  return !(
    a.west > b.east ||
    a.east < b.west ||
    a.south > b.north ||
    a.north < b.south
  );
}

function boundsContainLatLng(bounds, latlng) {
  return (
    latlng.lat >= bounds.south &&
    latlng.lat <= bounds.north &&
    latlng.lng >= bounds.west &&
    latlng.lng <= bounds.east
  );
}

function isPointInRect(point, rect) {
  return (
    point[0] >= rect.south &&
    point[0] <= rect.north &&
    point[1] >= rect.west &&
    point[1] <= rect.east
  );
}

function isPointInPolygon(point, polygonPoints) {
  const x = point[1];
  const y = point[0];
  let inside = false;

  for (
    let i = 0, j = polygonPoints.length - 1;
    i < polygonPoints.length;
    j = i++
  ) {
    const xi = polygonPoints[i][1];
    const yi = polygonPoints[i][0];
    const xj = polygonPoints[j][1];
    const yj = polygonPoints[j][0];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function isLatLngInSelectedArea(latlng) {
  if (!selectedAreaBounds) {
    return false;
  }

  if (!boundsContainLatLng(selectedAreaBounds, latlng)) {
    return false;
  }

  if (selectedAreaType === "rectangle") {
    return true;
  }

  if (selectedAreaType === "polygon") {
    return isPointInPolygon(
      [latlng.lat, latlng.lng],
      selectedAreaPolygonPoints,
    );
  }

  return false;
}

function getOrientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-12) {
    return 0;
  }
  return value > 0 ? 1 : 2;
}

function isPointOnSegment(a, b, c) {
  return (
    Math.min(a[0], c[0]) <= b[0] &&
    b[0] <= Math.max(a[0], c[0]) &&
    Math.min(a[1], c[1]) <= b[1] &&
    b[1] <= Math.max(a[1], c[1])
  );
}

function segmentsIntersect(p1, q1, p2, q2) {
  const o1 = getOrientation(p1, q1, p2);
  const o2 = getOrientation(p1, q1, q2);
  const o3 = getOrientation(p2, q2, p1);
  const o4 = getOrientation(p2, q2, q1);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }
  if (o1 === 0 && isPointOnSegment(p1, p2, q1)) {
    return true;
  }
  if (o2 === 0 && isPointOnSegment(p1, q2, q1)) {
    return true;
  }
  if (o3 === 0 && isPointOnSegment(p2, p1, q2)) {
    return true;
  }
  if (o4 === 0 && isPointOnSegment(p2, q1, q2)) {
    return true;
  }
  return false;
}

function cellIntersectsPolygon(corners, polygonPoints) {
  const cellBounds = getCellBoundsFromCorners(corners);

  for (const corner of corners) {
    if (isPointInPolygon(corner, polygonPoints)) {
      return true;
    }
  }

  for (const polygonPoint of polygonPoints) {
    if (isPointInRect(polygonPoint, cellBounds)) {
      return true;
    }
  }

  const cellEdges = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];

  for (let i = 0; i < polygonPoints.length; i += 1) {
    const a = polygonPoints[i];
    const b = polygonPoints[(i + 1) % polygonPoints.length];

    for (const [c, d] of cellEdges) {
      if (segmentsIntersect(a, b, c, d)) {
        return true;
      }
    }
  }

  return false;
}

function cellIntersectsSelectedArea(corners) {
  if (!selectedAreaBounds) {
    return false;
  }

  if (!boundsIntersect(selectedAreaBounds, getCellBoundsFromCorners(corners))) {
    return false;
  }

  if (selectedAreaType === "rectangle") {
    return true;
  }

  if (selectedAreaType === "polygon") {
    return cellIntersectsPolygon(corners, selectedAreaPolygonPoints);
  }

  return false;
}

function removeImageOverlay(cellId) {
  const entry = visibleOverlayByCellId.get(cellId);
  if (!entry) {
    return;
  }
  if (entry.imgEl && entry.imgEl.parentNode) {
    entry.imgEl.parentNode.removeChild(entry.imgEl);
  }
  visibleOverlayByCellId.delete(cellId);
}

function clearVisibleImageOverlays() {
  for (const cellId of visibleOverlayByCellId.keys()) {
    removeImageOverlay(cellId);
  }
}

function clearGrid() {
  gridCellById.clear();
  clearVisibleImageOverlays();
  activeCellId = null;
}

function positionOverlayImg(imgEl, cell) {
  const nw = map.project(
    new maplibregl.LngLat(cell.bounds.west, cell.bounds.north),
  );
  const se = map.project(
    new maplibregl.LngLat(cell.bounds.east, cell.bounds.south),
  );
  imgEl.style.left = `${nw.x}px`;
  imgEl.style.top = `${nw.y}px`;
  imgEl.style.width = `${se.x - nw.x}px`;
  imgEl.style.height = `${se.y - nw.y}px`;
}

function repositionAllOverlays() {
  for (const [cellId, entry] of visibleOverlayByCellId.entries()) {
    const cell = gridCellById.get(cellId);
    if (cell && entry.imgEl) {
      positionOverlayImg(entry.imgEl, cell);
    }
  }
  for (const [key, imgEl] of modifiedPixelHighlights.entries()) {
    const [cellId, x, y] = key.split("-");
    const cell = gridCellById.get(cellId);
    if (cell) {
      positionModifiedPixelHighlight(imgEl, cell, parseInt(x), parseInt(y));
    }
  }
}

function positionModifiedPixelHighlight(imgEl, cell, pixelX, pixelY) {
  const pixelWidth = cell.bounds.east - cell.bounds.west;
  const pixelHeight = cell.bounds.north - cell.bounds.south;
  const pixelLng =
    cell.bounds.west + (pixelX + 0.5) * (pixelWidth / GRID_IMAGE_SIZE);
  const pixelLat =
    cell.bounds.north - (pixelY + 0.5) * (pixelHeight / GRID_IMAGE_SIZE);

  const topLeftLng = cell.bounds.west + pixelX * (pixelWidth / GRID_IMAGE_SIZE);
  const topLeftLat =
    cell.bounds.north - pixelY * (pixelHeight / GRID_IMAGE_SIZE);
  const topLeft = map.project(new maplibregl.LngLat(topLeftLng, topLeftLat));

  const bottomRightLng =
    cell.bounds.west + (pixelX + 1) * (pixelWidth / GRID_IMAGE_SIZE);
  const bottomRightLat =
    cell.bounds.north - (pixelY + 1) * (pixelHeight / GRID_IMAGE_SIZE);
  const bottomRight = map.project(
    new maplibregl.LngLat(bottomRightLng, bottomRightLat),
  );

  const pixelScreenWidth = bottomRight.x - topLeft.x;
  const pixelScreenHeight = bottomRight.y - topLeft.y;

  imgEl.style.left = `${topLeft.x}px`;
  imgEl.style.top = `${topLeft.y}px`;
  imgEl.style.width = `${pixelScreenWidth}px`;
  imgEl.style.height = `${pixelScreenHeight}px`;
}

function removeModifiedPixelHighlight(key) {
  const imgEl = modifiedPixelHighlights.get(key);
  if (imgEl) {
    imgEl.remove();
    modifiedPixelHighlights.delete(key);
  }
}

function updateModifiedPixelHighlights(view) {
  for (const [key] of modifiedPixelHighlights.entries()) {
    const [cellId, x, y] = key.split("-");
    const cell = gridCellById.get(cellId);
    if (!cell || !boundsIntersect(view, cell.bounds)) {
      removeModifiedPixelHighlight(key);
    }
  }

  for (const [cellId, pixelMap] of cellPixelChanges.entries()) {
    const cell = gridCellById.get(cellId);
    if (!cell || !boundsIntersect(view, cell.bounds)) {
      continue;
    }

    for (const [pixelKey, pixelData] of pixelMap.entries()) {
      const highlightKey = `${cellId}-${pixelData.x}-${pixelData.y}`;

      if (modifiedPixelHighlights.has(highlightKey)) {
        const imgEl = modifiedPixelHighlights.get(highlightKey);
        positionModifiedPixelHighlight(imgEl, cell, pixelData.x, pixelData.y);
      } else {
        const imgEl = document.createElement("img");
        imgEl.src = "src/highlight.png";
        imgEl.style.position = "absolute";
        imgEl.style.imageRendering = "pixelated";
        imgEl.style.pointerEvents = "none";
        imgEl.style.opacity = "0.7";
        imgEl.style.zIndex = "2";
        overlayContainer.appendChild(imgEl);
        positionModifiedPixelHighlight(imgEl, cell, pixelData.x, pixelData.y);
        modifiedPixelHighlights.set(highlightKey, imgEl);
      }
    }
  }
}

function updateModifiedPixelHighlightsSmooth() {
  for (const [cellId, pixelMap] of cellPixelChanges.entries()) {
    const cell = gridCellById.get(cellId);
    if (!cell) continue;

    for (const [pixelKey, pixelData] of pixelMap.entries()) {
      const highlightKey = `${cellId}-${pixelData.x}-${pixelData.y}`;

      if (modifiedPixelHighlights.has(highlightKey)) {
        const imgEl = modifiedPixelHighlights.get(highlightKey);
        positionModifiedPixelHighlight(imgEl, cell, pixelData.x, pixelData.y);
      } else {
        const imgEl = document.createElement("img");
        imgEl.src = "src/highlight.png";
        imgEl.style.position = "absolute";
        imgEl.style.imageRendering = "pixelated";
        imgEl.style.pointerEvents = "none";
        imgEl.style.opacity = "0.7";
        imgEl.style.zIndex = "2";
        overlayContainer.appendChild(imgEl);
        positionModifiedPixelHighlight(imgEl, cell, pixelData.x, pixelData.y);
        modifiedPixelHighlights.set(highlightKey, imgEl);
      }
    }
  }
}

function toggleLayerOpacity() {
  isLayerOpacityEnabled = !isLayerOpacityEnabled;
  const toggleBtn = document.getElementById("toggleOpacityBtn");

  if (isLayerOpacityEnabled) {
    toggleBtn.classList.add("active");
  } else {
    toggleBtn.classList.remove("active");
  }

  for (const [cellId, entry] of visibleOverlayByCellId.entries()) {
    if (entry.imgEl) {
      entry.imgEl.style.opacity = isLayerOpacityEnabled ? "0.4" : "1";
    }
  }
}

async function updateVisibleCellImages() {
  if (!mapReady || gridCellById.size === 0) {
    return;
  }

  const viewBounds = map.getBounds();
  const view = {
    south: viewBounds.getSouth(),
    north: viewBounds.getNorth(),
    west: viewBounds.getWest(),
    east: viewBounds.getEast(),
  };

  for (const [cellId] of visibleOverlayByCellId.entries()) {
    const cell = gridCellById.get(cellId);
    if (!cell || !boundsIntersect(view, cell.bounds)) {
      removeImageOverlay(cellId);
    }
  }

  for (const [cellId, cell] of gridCellById.entries()) {
    if (!boundsIntersect(view, cell.bounds)) {
      continue;
    }

    const canvas = await getCellCanvas(cellId);
    const dataUrl = canvas.toDataURL("image/png");

    if (visibleOverlayByCellId.has(cellId)) {
      const entry = visibleOverlayByCellId.get(cellId);
      entry.imgEl.src = dataUrl;
      positionOverlayImg(entry.imgEl, cell);
      continue;
    }

    const imgEl = document.createElement("img");
    imgEl.src = dataUrl;
    imgEl.style.position = "absolute";
    imgEl.style.imageRendering = "pixelated";
    imgEl.style.pointerEvents = "none";
    imgEl.style.opacity = isLayerOpacityEnabled ? "0.4" : "1";
    imgEl.style.transition = "opacity 0.3s ease-out";
    overlayContainer.appendChild(imgEl);
    positionOverlayImg(imgEl, cell);

    visibleOverlayByCellId.set(cellId, { imgEl });
  }

  updateModifiedPixelHighlights(view);
}

async function refreshVisibleCellImagesPeriodically() {
  if (isPeriodicVisibleImageRefreshRunning) {
    return;
  }

  if (!mapReady || map.getZoom() <= VISIBLE_IMAGE_REFRESH_MIN_ZOOM) {
    return;
  }

  isPeriodicVisibleImageRefreshRunning = true;
  try {
    await updateVisibleCellImages();
  } finally {
    isPeriodicVisibleImageRefreshRunning = false;
  }
}

function startVisibleImageRefreshInterval() {
  if (visibleImageRefreshIntervalId !== null) {
    return;
  }

  visibleImageRefreshIntervalId = setInterval(() => {
    refreshVisibleCellImagesPeriodically();
  }, VISIBLE_IMAGE_REFRESH_INTERVAL_MS);
}

function findCellIdAtLatLng(latlng) {
  for (const [cellId, cell] of gridCellById.entries()) {
    if (boundsContainLatLng(cell.bounds, latlng)) {
      return cellId;
    }
  }
  return null;
}

function getPixelIndexFromLatLng(cell, latlng) {
  const north = cell.bounds.north;
  const south = cell.bounds.south;
  const west = cell.bounds.west;
  const east = cell.bounds.east;

  const xRatio = (latlng.lng - west) / (east - west);
  const yRatio = (north - latlng.lat) / (north - south);

  const x = Math.min(
    GRID_IMAGE_SIZE - 1,
    Math.max(0, Math.floor(xRatio * GRID_IMAGE_SIZE)),
  );
  const y = Math.min(
    GRID_IMAGE_SIZE - 1,
    Math.max(0, Math.floor(yRatio * GRID_IMAGE_SIZE)),
  );

  return { x, y };
}

async function paintPixelOnMap(cellId, latlng) {
  const cell = gridCellById.get(cellId);
  if (!cell) {
    return;
  }

  const cellCanvas = await getCellCanvas(cellId);
  const cellContext = cellCanvas.getContext("2d");
  const { x, y } = getPixelIndexFromLatLng(cell, latlng);
  const pixelKey = `${x}-${y}`;

  if (currentPixelColor === "TRANSPARENT") {
    if (
      cellPixelChanges.has(cellId) &&
      cellPixelChanges.get(cellId).has(pixelKey)
    ) {
      cellContext.clearRect(x, y, 1, 1);
      cellPixelChanges.get(cellId).delete(pixelKey);
      if (cellPixelChanges.get(cellId).size === 0) {
        cellPixelChanges.delete(cellId);
      }
    } else {
      return;
    }
  } else {
    const isExistingUnsavedPixel =
      cellPixelChanges.has(cellId) &&
      cellPixelChanges.get(cellId).has(pixelKey);

    if (!isExistingUnsavedPixel && !canPlaceMorePixels()) {
      updatePaintButtonLabel();
      return;
    }

    cellContext.fillStyle = currentPixelColor;
    cellContext.fillRect(x, y, 1, 1);

    if (!cellPixelChanges.has(cellId)) {
      cellPixelChanges.set(cellId, new Map());
    }
    cellPixelChanges
      .get(cellId)
      .set(pixelKey, { x, y, color: currentPixelColor });
  }

  cellImageCanvasById.set(cellId, cellCanvas);
  dirtyCellIds.add(cellId);

  const dataUrl = cellCanvas.toDataURL("image/png");

  if (visibleOverlayByCellId.has(cellId)) {
    const entry = visibleOverlayByCellId.get(cellId);
    entry.imgEl.src = dataUrl;
  } else {
    const imgEl = document.createElement("img");
    imgEl.src = dataUrl;
    imgEl.style.position = "absolute";
    imgEl.style.imageRendering = "pixelated";
    imgEl.style.pointerEvents = "none";
    imgEl.style.opacity = isLayerOpacityEnabled ? "0.4" : "1";
    overlayContainer.appendChild(imgEl);
    positionOverlayImg(imgEl, cell);
    visibleOverlayByCellId.set(cellId, { imgEl });
  }

  updatePaintButtonLabel();

  if (map.getZoom() <= 16.5) {
    map.easeTo({
      center: [latlng.lng, latlng.lat],
      zoom: 19,
      duration: 800,
      easing: (t) => {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      },
    });
  }
}

async function setActiveCell(cellId) {
  activeCellId = cellId;
  await getCellCanvas(cellId);
}

async function savePixelChanges() {
  if (dirtyCellIds.size === 0) {
    return;
  }

  const cellUpdates = Array.from(dirtyCellIds)
    .map((cellId) => {
      const pixelMap = cellPixelChanges.get(cellId);
      if (!pixelMap || pixelMap.size === 0) {
        return null;
      }
      return {
        cellId,
        pixels: Array.from(pixelMap.values()),
      };
    })
    .filter(Boolean);

  if (cellUpdates.length === 0) {
    return;
  }

  try {
    const response = await fetch("/api/grid-images/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cellUpdates }),
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      currentUser = null;
      updateAuthUI();
      alert("로그인이 필요합니다. 다시 로그인해주세요.");
      document.getElementById("loginModal").classList.add("show");
      return;
    }

    if (response.status === 429) {
      updatePaintButtonLabel();
      return;
    }

    if (!response.ok) {
      throw new Error("저장 요청 실패");
    }

    usedPixelsThisHour = Number(data.usedPixelsThisHour || usedPixelsThisHour);
    pixelLimitPerHour = Number(data.pixelLimitPerHour || pixelLimitPerHour);

    for (const cellId of dirtyCellIds) {
      const prevVersion = imageVersionByCellId.get(cellId) || 0;
      imageVersionByCellId.set(cellId, prevVersion + 1);
    }

    dirtyCellIds.clear();
    cellPixelChanges.clear();

    for (const [key, imgEl] of modifiedPixelHighlights.entries()) {
      imgEl.remove();
    }
    modifiedPixelHighlights.clear();

    updateVisibleCellImages();
    updatePaintButtonLabel();
  } catch (error) {
    console.error(error);
  }
}

async function discardPixelChanges() {
  if (dirtyCellIds.size === 0) {
    return;
  }

  try {
    for (const cellId of dirtyCellIds) {
      imageVersionByCellId.delete(cellId);

      const url = getCellImageRequestUrl(cellId);
      const canvas = await loadImageIntoCanvas(url);
      cellImageCanvasById.set(cellId, canvas);

      const overlayEntry = visibleOverlayByCellId.get(cellId);
      if (overlayEntry && overlayEntry.imgEl) {
        overlayEntry.imgEl.src = canvas.toDataURL("image/png");
      }
    }

    dirtyCellIds.clear();
    cellPixelChanges.clear();

    for (const [key, imgEl] of modifiedPixelHighlights.entries()) {
      imgEl.remove();
    }
    modifiedPixelHighlights.clear();

    updateVisibleCellImages();
  } catch (error) {
    console.error("Error discarding changes:", error);
  }
}

function generateGrid() {
  clearGrid();

  const south = selectedAreaBounds.south;
  const north = selectedAreaBounds.north;
  const west = selectedAreaBounds.west;
  const east = selectedAreaBounds.east;
  const latStep = metersToLatDegrees(GRID_SIZE_METERS);

  let row = 0;

  for (let lat = south; lat < north; lat += latStep) {
    const nextLat = Math.min(lat + latStep, north);
    const centerLat = (lat + nextLat) / 2;
    const lngStep = metersToLngDegrees(GRID_SIZE_METERS, centerLat);
    let col = 0;

    for (let lng = west; lng < east; lng += lngStep) {
      const nextLng = Math.min(lng + lngStep, east);
      const corners = [
        [lat, lng],
        [lat, nextLng],
        [nextLat, nextLng],
        [nextLat, lng],
      ];

      if (!cellIntersectsSelectedArea(corners)) {
        col += 1;
        continue;
      }

      const cellId = `${row}-${col}`;
      const bounds = getCellBoundsFromCorners(corners);

      gridCellById.set(cellId, {
        id: cellId,
        row,
        col,
        corners,
        bounds,
      });

      col += 1;
    }

    row += 1;
  }

  updateVisibleCellImages();
}

let mouseDownPosition = null;

async function handleMouseDown(event) {
  const latlng = { lat: event.lngLat.lat, lng: event.lngLat.lng };
  const cellId = findCellIdAtLatLng(latlng);
  if (!cellId) {
    return;
  }

  mouseDownPosition = { lat: latlng.lat, lng: latlng.lng };
  isMouseDown = true;

  const palette = document.getElementById("colorPalette");
  const isPaletteOpen = palette.classList.contains("active");

  if (
    isSpacePressed &&
    isPaletteOpen &&
    cellId &&
    isLatLngInSelectedArea(latlng)
  ) {
    await setActiveCell(cellId);
    await paintPixelOnMap(cellId, latlng);
    updateVisibleCellImages();
  }
}

async function handleMouseUp(event) {
  isMouseDown = false;

  if (!mouseDownPosition) {
    return;
  }

  const latlng = { lat: event.lngLat.lat, lng: event.lngLat.lng };
  const cellId = findCellIdAtLatLng(latlng);
  if (!cellId) {
    mouseDownPosition = null;
    return;
  }

  if (!isLatLngInSelectedArea(latlng)) {
    mouseDownPosition = null;
    return;
  }

  const latDiff = Math.abs(latlng.lat - mouseDownPosition.lat);
  const lngDiff = Math.abs(latlng.lng - mouseDownPosition.lng);
  const clickThreshold = 0.00001;

  if (
    latDiff < clickThreshold &&
    lngDiff < clickThreshold &&
    isPaintModeActive
  ) {
    await setActiveCell(cellId);
    await paintPixelOnMap(cellId, latlng);
    updateVisibleCellImages();
  }

  mouseDownPosition = null;
}

function handleMouseMove(event) {
  if (!mapReady) return;

  const latlng = { lat: event.lngLat.lat, lng: event.lngLat.lng };
  const cellId = findCellIdAtLatLng(latlng);
  const canvas = map.getCanvas();

  if (!cellId || !isLatLngInSelectedArea(latlng)) {
    pixelHighlight.style.display = "none";
    canvas.style.cursor = isPaintModeActive
      ? "crosshair"
      : isSpacePressed
        ? "crosshair"
        : "grab";
    return;
  }

  canvas.style.cursor =
    isPaintModeActive || isSpacePressed ? "crosshair" : "grab";

  const palette = document.getElementById("colorPalette");
  const isPaletteOpen = palette.classList.contains("active");

  if (isSpacePressed && isPaletteOpen && isMouseDown) {
    paintPixelOnMap(cellId, latlng);
    updateVisibleCellImages();
  }

  const overlayEntry = visibleOverlayByCellId.get(cellId);
  if (!overlayEntry || !overlayEntry.imgEl) {
    pixelHighlight.style.display = "none";
    return;
  }
  const overlayImg = overlayEntry.imgEl;

  const cellInfo = gridCellById.get(cellId);
  if (!cellInfo) return;

  const { x: pixelX, y: pixelY } = getPixelIndexFromLatLng(cellInfo, latlng);

  if (
    pixelX < 0 ||
    pixelX >= GRID_IMAGE_SIZE ||
    pixelY < 0 ||
    pixelY >= GRID_IMAGE_SIZE
  ) {
    pixelHighlight.style.display = "none";
    return;
  }

  if (isPaintModeActive) {
    const imgLeft = parseFloat(overlayImg.style.left) || 0;
    const imgTop = parseFloat(overlayImg.style.top) || 0;
    const imgWidth = parseFloat(overlayImg.style.width) || 0;
    const imgHeight = parseFloat(overlayImg.style.height) || 0;

    const pixelWidth = imgWidth / GRID_IMAGE_SIZE;
    const pixelHeight = imgHeight / GRID_IMAGE_SIZE;

    const highlightX = imgLeft + pixelX * pixelWidth;
    const highlightY = imgTop + pixelY * pixelHeight;

    pixelHighlight.style.left = highlightX + "px";
    pixelHighlight.style.top = highlightY + "px";
    pixelHighlight.style.width = pixelWidth + "px";
    pixelHighlight.style.height = pixelHeight + "px";
    pixelHighlight.style.display = "block";
  } else {
    pixelHighlight.style.display = "none";
  }
}

async function loadOsmData() {
  try {
    const response = await fetch("/api/osm-data");
    await response.json();
  } catch (error) {
    console.error("Data load error:", error);
  }
}

function getBoundsFromPoints(points) {
  const lats = points.map((point) => point[0]);
  const lngs = points.map((point) => point[1]);
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
  };
}

function fitMapToBounds(bounds) {
  const lngLatBounds = new maplibregl.LngLatBounds(
    [bounds.west, bounds.south],
    [bounds.east, bounds.north],
  );
  map.fitBounds(lngLatBounds, { padding: 20, duration: 0, minZoom: 19 });
}

async function loadSelectedArea() {
  const response = await fetch("/api/selected-area");
  const areaData = await response.json();

  if (areaData.type === "polygon") {
    selectedAreaType = "polygon";
    selectedAreaPolygonPoints = areaData.points;
    selectedAreaBounds = getBoundsFromPoints(areaData.points);
    fitMapToBounds(selectedAreaBounds);
    map.setZoom(17.4);
  } else {
    selectedAreaType = "rectangle";
    selectedAreaPolygonPoints = [];

    const bounds = getBoundsFromPoints(areaData.bounds);
    selectedAreaBounds = bounds;
    fitMapToBounds(bounds);
    map.setZoom(19);
  }

  generateGrid();
  addGrayscaleMaskOutsideArea();
}

function addGrayscaleMaskOutsideArea() {
  if (!selectedAreaBounds) {
    return;
  }

  const worldBounds = [
    [-180, -90],
    [180, -90],
    [180, 90],
    [-180, 90],
    [-180, -90],
  ];

  let holeCoordinates;

  if (selectedAreaType === "polygon" && selectedAreaPolygonPoints.length > 0) {
    holeCoordinates = [...selectedAreaPolygonPoints]
      .reverse()
      .map((point) => [point[1], point[0]]);
  } else if (selectedAreaType === "rectangle" && selectedAreaBounds) {
    const { north, south, east, west } = selectedAreaBounds;
    holeCoordinates = [
      [east, north],
      [west, north],
      [west, south],
      [east, south],
      [east, north],
    ];
  } else {
    return;
  }

  if (holeCoordinates.length > 0) {
    const first = holeCoordinates[0];
    const last = holeCoordinates[holeCoordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      holeCoordinates.push([...first]);
    }
  }

  const maskGeojson = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [worldBounds, holeCoordinates],
    },
  };

  if (map.getLayer("grayscale-mask-layer")) {
    map.removeLayer("grayscale-mask-layer");
  }
  if (map.getSource("grayscale-mask")) {
    map.removeSource("grayscale-mask");
  }

  map.addSource("grayscale-mask", {
    type: "geojson",
    data: maskGeojson,
  });

  map.addLayer({
    id: "grayscale-mask-layer",
    type: "fill",
    source: "grayscale-mask",
    paint: {
      "fill-color": "#808080",
      "fill-opacity": 0.2,
    },
  });
}

function initializeColorPalette() {
  const palette = document.getElementById("colorPalette");
  const toolbar = document.getElementById("floatingToolbar");
  palette.innerHTML = "";

  let closeBtn = document.getElementById("closePaletteBtn");
  if (!closeBtn) {
    closeBtn = document.createElement("button");
    closeBtn.id = "closePaletteBtn";
    closeBtn.textContent = "\u2715";
    closeBtn.title = "취소 및 닫기";
    closeBtn.addEventListener("click", async () => {
      palette.classList.remove("active");
      toolbar.classList.remove("palette-open");
      setTimeout(() => {
        isPaintModeActive = false;
        map.getCanvas().style.cursor = "grab";
        pixelHighlight.style.display = "none";
      }, 300);
      await discardPixelChanges();
      updatePaintButtonLabel();
    });
    toolbar.appendChild(closeBtn);
  }

  let eraseBtn = document.getElementById("erasePaletteBtn");
  if (!eraseBtn) {
    eraseBtn = document.createElement("button");
    eraseBtn.id = "erasePaletteBtn";
    eraseBtn.title = "저장되지 않은 픽셀 지우기";
    const eraseImg = document.createElement("img");
    eraseImg.src = "src/erase.png";
    eraseImg.alt = "지우기";
    eraseBtn.appendChild(eraseImg);
    eraseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (isEraseMode) {
        isEraseMode = false;
        eraseBtn.classList.remove("selected");
        const fallbackColor = PALETTE_COLORS[0];
        currentPixelColor = fallbackColor;
        const colorButtons = document.querySelectorAll(".color-button");
        colorButtons.forEach((btn) => {
          btn.classList.remove("selected");
        });
        if (colorButtons.length > 0) {
          colorButtons[0].classList.add("selected");
        }
        updatePaintButtonLabel();
        return;
      }

      isEraseMode = true;
      eraseBtn.classList.add("selected");
      document.querySelectorAll(".color-button").forEach((btn) => {
        btn.classList.remove("selected");
      });
      currentPixelColor = "TRANSPARENT";
      updatePaintButtonLabel();
    });
    toolbar.appendChild(eraseBtn);
  }

  PALETTE_COLORS.forEach((color) => {
    const button = document.createElement("button");
    button.className = "color-button";

    if (color === "TRANSPARENT") {
      button.style.background =
        "linear-gradient(135deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(135deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)";
      button.style.backgroundSize = "8px 8px";
      button.style.backgroundPosition = "0 0, 4px 4px";
      button.style.backgroundColor = "#f0f0f0";
      button.title = "투명 (Erase와 동일)";
    } else {
      button.style.backgroundColor = color;
    }

    if (color === currentPixelColor) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      if (isEraseMode) {
        isEraseMode = false;
        const eraseBtn = document.getElementById("erasePaletteBtn");
        if (eraseBtn) {
          eraseBtn.classList.remove("selected");
        }
      }

      document.querySelectorAll(".color-button").forEach((btn) => {
        btn.classList.remove("selected");
      });
      button.classList.add("selected");
      currentPixelColor = color;
    });
    palette.appendChild(button);
  });

  paintBtn.addEventListener("click", async () => {
    const palette = document.getElementById("colorPalette");
    const toolbar = document.getElementById("floatingToolbar");
    if (!palette.classList.contains("active")) {
      if (!currentUser) {
        document.getElementById("loginModal").classList.add("show");
        return;
      }

      palette.classList.add("active");
      toolbar.classList.add("palette-open");
      isPaintModeActive = true;
      updatePaintButtonLabel();
    } else {
      palette.classList.remove("active");
      toolbar.classList.remove("palette-open");
      setTimeout(() => {
        isPaintModeActive = false;
        map.getCanvas().style.cursor = "grab";
        pixelHighlight.style.display = "none";
      }, 300);
      await savePixelChanges();
      updatePaintButtonLabel();
    }
  });
}

function updatePaintButtonLabel() {
  const palette = document.getElementById("colorPalette");
  const isPaletteOpen = palette.classList.contains("active");

  const totalPixels = getUnsavedPixelCount();
  const totalInCurrentWindow = getCurrentWindowTotalPixels();

  let spanEl = paintBtn.querySelector("span");
  if (!spanEl) {
    spanEl = document.createElement("span");
    paintBtn.appendChild(spanEl);
  }

  if (isPaletteOpen) {
    spanEl.textContent = `저장하기 (${totalInCurrentWindow}/${pixelLimitPerHour})`;
  } else {
    spanEl.textContent = "시작하기";
  }

  if (isPaletteOpen && totalPixels === 0) {
    paintBtn.disabled = true;
  } else {
    paintBtn.disabled = false;
  }
}

function focusCurrentLocation() {
  if (!navigator.geolocation) {
    return;
  }

  currentLocationBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;

      if (!currentLocationMarker) {
        const markerEl = document.createElement("div");
        markerEl.style.width = "14px";
        markerEl.style.height = "14px";
        markerEl.style.borderRadius = "50%";
        markerEl.style.background = "#ff2f2f";
        markerEl.style.border = "2px solid #ffffff";
        markerEl.style.boxShadow = "0 0 0 2px rgba(255, 47, 47, 0.35)";

        currentLocationMarker = new maplibregl.Marker({ element: markerEl })
          .setLngLat([longitude, latitude])
          .addTo(map);
      } else {
        currentLocationMarker.setLngLat([longitude, latitude]);
      }

      map.flyTo({
        center: [longitude, latitude],
        zoom: Math.max(map.getZoom(), 18),
        essential: true,
      });

      currentLocationBtn.disabled = false;
    },
    () => {
      currentLocationBtn.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    },
  );
}

map.on("load", () => {
  mapReady = true;
  startVisibleImageRefreshInterval();

  initializeColorPalette();
  updatePaintButtonLabel();

  document
    .getElementById("toggleOpacityBtn")
    .addEventListener("click", toggleLayerOpacity);

  currentLocationBtn.addEventListener("click", focusCurrentLocation);

  map.on("zoomend", updateVisibleCellImages);
  map.on("moveend", updateVisibleCellImages);
  map.on("move", () => {
    repositionAllOverlays();
    pixelHighlight.style.display = "none";
    updateModifiedPixelHighlightsSmooth();
  });
  map.on("zoom", () => {
    repositionAllOverlays();
    pixelHighlight.style.display = "none";
    updateModifiedPixelHighlightsSmooth();
  });
  map.on("mousemove", handleMouseMove);
  map.on("mousedown", handleMouseDown);
  map.on("mouseup", handleMouseUp);
  map.on("mouseleave", () => {
    pixelHighlight.style.display = "none";
  });

  loadOsmData();
  loadSelectedArea();
});

window.addEventListener("beforeunload", () => {
  if (visibleImageRefreshIntervalId !== null) {
    clearInterval(visibleImageRefreshIntervalId);
    visibleImageRefreshIntervalId = null;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !isSpacePressed) {
    event.preventDefault();
    isSpacePressed = true;
    map.getCanvas().style.cursor = "crosshair";
    map.dragPan.disable();
  }
});

document.addEventListener("keyup", (event) => {
  if (event.code === "Space" && isSpacePressed) {
    event.preventDefault();
    isSpacePressed = false;
    map.getCanvas().style.cursor = isPaintModeActive ? "crosshair" : "grab";
    map.dragPan.enable();
  }
});

document.addEventListener("mouseup", () => {
  isMouseDown = false;
});
