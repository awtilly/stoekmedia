/* ============================================================
   GreenDoor — Address Autocomplete
   Free implementation backed by Nominatim (OpenStreetMap).
   No API key, no quota. Honors OSM usage policy by debouncing
   keystrokes >= 500ms and capping suggestions per request.
   ============================================================ */

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const DEBOUNCE_MS = 500;
const MAX_SUGGESTIONS = 5;

let styleInjected = false;

function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
.gd-addr-suggest{position:absolute;z-index:1000;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.08);max-height:260px;overflow-y:auto;font-size:14px;}
.gd-addr-suggest button{display:block;width:100%;text-align:left;padding:10px 12px;background:none;border:0;border-bottom:1px solid #f3f4f6;cursor:pointer;font:inherit;color:#111827;}
.gd-addr-suggest button:hover,.gd-addr-suggest button:focus{background:#f9fafb;outline:none;}
.gd-addr-suggest button:last-child{border-bottom:0;}
.gd-addr-suggest .gd-addr-loading{padding:10px 12px;color:#6b7280;}
`;
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.appendChild(tag);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function parseNominatim(item) {
  const a = item.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ").trim();
  return {
    full: item.display_name || "",
    street,
    city: a.city || a.town || a.village || a.hamlet || "",
    state: a.state_code || (a.state ? stateToAbbr(a.state) : ""),
    zip: a.postcode || "",
    county: a.county || "",
    neighborhood: a.neighbourhood || a.suburb || "",
    lat: item.lat ? parseFloat(item.lat) : null,
    lng: item.lon ? parseFloat(item.lon) : null
  };
}

const STATE_ABBR = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA",
  "Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD",
  "Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO",
  "Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ",
  "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH",
  "Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
  "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
  "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
  "District of Columbia":"DC"
};
function stateToAbbr(name) { return STATE_ABBR[name] || name; }

async function searchAddresses(query) {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    addressdetails: "1",
    countrycodes: "us",
    limit: String(MAX_SUGGESTIONS)
  });
  const resp = await fetch(`${NOMINATIM_ENDPOINT}?${params}`, {
    headers: { "Accept": "application/json" }
  });
  if (!resp.ok) return [];
  return resp.json();
}

/**
 * Initialize address autocomplete on an input element.
 * Contract is unchanged from the prior Google Places implementation.
 *
 * @param {string} inputId — DOM id of the text input
 * @param {Function} onPlaceSelected — callback({full, street, city, state, zip, county, neighborhood, lat, lng})
 * @returns {{ destroy: Function } | null}
 */
export function initAddressAutocomplete(inputId, onPlaceSelected) {
  const input = document.getElementById(inputId);
  if (!input) return null;

  injectStyles();

  const dropdown = document.createElement("div");
  dropdown.className = "gd-addr-suggest";
  dropdown.style.display = "none";
  document.body.appendChild(dropdown);

  function position() {
    const r = input.getBoundingClientRect();
    dropdown.style.left = `${r.left + window.scrollX}px`;
    dropdown.style.top = `${r.bottom + window.scrollY + 4}px`;
    dropdown.style.width = `${r.width}px`;
  }

  function hide() { dropdown.style.display = "none"; dropdown.innerHTML = ""; }
  function showLoading() {
    position();
    dropdown.innerHTML = '<div class="gd-addr-loading">Searching…</div>';
    dropdown.style.display = "block";
  }
  function showResults(items) {
    position();
    if (!items.length) {
      dropdown.innerHTML = '<div class="gd-addr-loading">No matches.</div>';
    } else {
      dropdown.innerHTML = items
        .map((it, i) => `<button type="button" data-i="${i}">${escapeHtml(it.display_name)}</button>`)
        .join("");
      dropdown.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const idx = Number(btn.dataset.i);
          const parsed = parseNominatim(items[idx]);
          input.value = parsed.full;
          hide();
          if (onPlaceSelected) onPlaceSelected(parsed);
        });
      });
    }
    dropdown.style.display = "block";
  }

  const runSearch = debounce(async (q) => {
    if (q.length < 3) { hide(); return; }
    showLoading();
    try {
      const items = await searchAddresses(q);
      showResults(items);
    } catch (err) {
      console.warn("Address search failed:", err);
      hide();
    }
  }, DEBOUNCE_MS);

  const onInput = () => runSearch(input.value.trim());
  const onBlur = () => setTimeout(hide, 150);
  const onFocus = () => { if (input.value.trim().length >= 3) runSearch(input.value.trim()); };
  const onScroll = () => { if (dropdown.style.display !== "none") position(); };

  input.addEventListener("input", onInput);
  input.addEventListener("blur", onBlur);
  input.addEventListener("focus", onFocus);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  return {
    destroy() {
      input.removeEventListener("input", onInput);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("focus", onFocus);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      dropdown.remove();
    }
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
