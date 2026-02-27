/* ============================================================
   GreenDoor — Address Autocomplete
   Google Places Autocomplete wrapper with structured address output.
   ============================================================ */

/**
 * Initialize Google Places Autocomplete on an input element.
 * @param {string} inputId — DOM id of the text input
 * @param {Function} onPlaceSelected — callback({ full, street, city, state, zip, county, neighborhood, lat, lng })
 * @returns {google.maps.places.Autocomplete|null}
 */
export function initAddressAutocomplete(inputId, onPlaceSelected) {
  const input = document.getElementById(inputId);
  if (!input) return null;

  // Graceful fallback if Google Maps API not loaded
  if (typeof google === "undefined" || !google.maps || !google.maps.places) {
    console.warn("Google Maps Places API not loaded — autocomplete disabled.");
    return null;
  }

  const autocomplete = new google.maps.places.Autocomplete(input, {
    types: ["address"],
    componentRestrictions: { country: "us" },
    fields: ["address_components", "formatted_address", "geometry"]
  });

  // Bias toward MO/IL region
  const moBounds = new google.maps.LatLngBounds(
    new google.maps.LatLng(36.0, -95.8),  // SW corner
    new google.maps.LatLng(40.6, -89.0)   // NE corner
  );
  autocomplete.setBounds(moBounds);

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    if (!place || !place.address_components) return;

    const result = {
      full: place.formatted_address || "",
      street: "",
      city: "",
      state: "",
      zip: "",
      county: "",
      neighborhood: "",
      lat: place.geometry?.location?.lat() || null,
      lng: place.geometry?.location?.lng() || null
    };

    for (const comp of place.address_components) {
      const types = comp.types;
      if (types.includes("street_number")) {
        result.street = comp.long_name + " " + result.street;
      } else if (types.includes("route")) {
        result.street = result.street + comp.long_name;
      } else if (types.includes("locality")) {
        result.city = comp.long_name;
      } else if (types.includes("administrative_area_level_1")) {
        result.state = comp.short_name;
      } else if (types.includes("postal_code")) {
        result.zip = comp.long_name;
      } else if (types.includes("administrative_area_level_2")) {
        result.county = comp.long_name;
      } else if (types.includes("neighborhood") || types.includes("sublocality_level_1")) {
        result.neighborhood = comp.long_name;
      }
    }

    result.street = result.street.trim();

    if (onPlaceSelected) onPlaceSelected(result);
  });

  return autocomplete;
}
