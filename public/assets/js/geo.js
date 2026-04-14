const geoText = document.getElementById("geoText");
const geoJson = document.getElementById("geoJson");
const mapEl = document.getElementById("map");
let map;

async function loadGeo() {
  try {
    const res = await fetch("https://ipapi.co/json/");
    const data = await res.json();
    const payload = {
      ...data,
      latitude: data.latitude,
      longitude: data.longitude,
    };

    geoText.textContent = `${data.city}, ${data.region}, ${data.country_name} (${data.ip})`;

    if (mapEl) {
      map = L.map(mapEl).setView([data.latitude, data.longitude], 8);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      L.marker([data.latitude, data.longitude]).addTo(map).bindPopup("IP-based location").openPopup();
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          payload.latitude = lat;
          payload.longitude = lng;
          if (mapEl && map) {
            map.setView([lat, lng], 12);
            L.marker([lat, lng]).addTo(map).bindPopup("Device location").openPopup();
          }
          geoText.textContent = `${data.city}, ${data.region}, ${data.country_name} (${data.ip}) • Device location enabled`;
          if (geoJson) geoJson.value = JSON.stringify(payload);
        },
        () => {
          if (geoJson) geoJson.value = JSON.stringify(payload);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    } else {
      if (geoJson) geoJson.value = JSON.stringify(payload);
    }
  } catch (e) {
    geoText.textContent = "Location unavailable";
    if (geoJson) geoJson.value = "{}";
  }
}

loadGeo();
