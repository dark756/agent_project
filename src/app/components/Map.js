"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import axios from "axios";

const redPinIcon = () =>
  L.divIcon({
    className: "",
    html: `<div style="
      width:0;height:0;
      border-left:10px solid transparent;
      border-right:10px solid transparent;
      border-top:28px solid #e53e3e;
      position:relative;
      filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35));
    ">
      <div style="
        position:absolute;top:-32px;left:-8px;
        width:16px;height:16px;
        background:#e53e3e;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        border:2px solid white;
      "></div>
    </div>`,
    iconSize: [20, 28],
    iconAnchor: [10, 28],
  });

function ClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function MapSelector({ setLocation, markerPos }) {
  const [leafletReady, setLeafletReady] = useState(false);
  const [mapKey] = useState(() => Math.random().toString(36).slice(2));
  const [isGeocoding, setIsGeocoding] = useState(false);
  const iconRef = useRef(null);

  useEffect(() => {
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
    iconRef.current = redPinIcon();
    setLeafletReady(true);
  }, []);

  async function handleMapClick({ lat, lng }) {
    // Immediately drop the pin at clicked coords
    setLocation({ lat, lng, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}` });
    setIsGeocoding(true);
    try {
      const { data } = await axios.get(
        "https://nominatim.openstreetmap.org/reverse",
        {
          params: { format: "json", lat, lon: lng },
          headers: { "Accept-Language": "en" },
        }
      );
      // Build a readable place label from the response
      const addr = data.address ?? {};
      const label =
        addr.city ||
        addr.city_district ||
        addr.town ||
        addr.village ||
        addr.county ||
        addr.state ||
        data.display_name?.split(",")[0] ||
        `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

      setLocation({ lat, lng, label });
    } catch {
      // Geocoding failed — coordinates are still set, label stays as coords
    } finally {
      setIsGeocoding(false);
    }
  }

  if (!leafletReady) {
    return (
      <div style={{
        height: 400, display: "flex", alignItems: "center",
        justifyContent: "center", background: "#f7fafc", color: "#a0aec0", fontSize: 14
      }}>
        Loading map...
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <MapContainer
        key={mapKey}
        center={[20.5937, 78.9629]}
        zoom={5}
        style={{ height: 400, width: "100%" }}
      >
        <TileLayer
          // attribution="&copy; OpenStreetMap"
          // url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"//removed due to non english locations
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> &copy; <a href="https://carto.com">CARTO</a>'
        />
        <ClickHandler onMapClick={handleMapClick} />
        {markerPos && (
          <Marker position={[markerPos.lat, markerPos.lng]} icon={iconRef.current} />
        )}
      </MapContainer>

      {/* Geocoding spinner overlaid on map */}
      {isGeocoding && (
        <div style={{
          position: "absolute", top: 8, right: 8, zIndex: 1000,
          background: "white", borderRadius: 8, padding: "6px 10px",
          fontSize: 12, color: "#718096", boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{
            width: 12, height: 12, border: "2px solid #e2e8f0",
            borderTopColor: "#2b6cb0", borderRadius: "50%",
            display: "inline-block", animation: "spin 0.8s linear infinite",
          }} />
          Looking up location...
        </div>
      )}
    </div>
  );
}