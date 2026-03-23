"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import axios from "axios";

// ── Leaflet CSS is injected once, globally, on first mount ────────────────────
// Putting this outside the component means multiple MapSelector instances
// on the same page share a single injection — no race conditions, no
// "document is not defined" crashes from concurrent SSR/hydration.

let leafletCssInjected = false;

function ensureLeafletCss() {
  if (leafletCssInjected) return;
  if (typeof document === "undefined") return;
  if (!document.querySelector('link[href*="leaflet"]')) {
    const link = document.createElement("link");
    link.rel  = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }
  leafletCssInjected = true;
}

// ── Default icon fix is also global — only needs to run once ─────────────────

let leafletIconFixed = false;

function fixLeafletIcon() {
  if (leafletIconFixed) return;
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
  leafletIconFixed = true;
}

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
    iconSize:   [20, 28],
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

// ── instanceCounter gives every MapContainer a unique, stable id ─────────────
// Using Math.random() inside useState initialiser is fine for uniqueness but
// we also derive an instanceId so Leaflet never sees two containers with the
// same DOM node.

let instanceCounter = 0;

export default function MapSelector({ setLocation, markerPos }) {
  // Each instance gets its own counter-based id, created once on mount.
  const [instanceId]   = useState(() => ++instanceCounter);
  const [leafletReady, setLeafletReady] = useState(false);
  const [isGeocoding,  setIsGeocoding]  = useState(false);
  const iconRef = useRef(null);

  useEffect(() => {
    ensureLeafletCss();
    fixLeafletIcon();
    iconRef.current = redPinIcon();
    setLeafletReady(true);
  }, []);

  async function handleMapClick({ lat, lng }) {
    setLocation({ lat, lng, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}` });
    setIsGeocoding(true);
    try {
      const { data } = await axios.get(
        "https://nominatim.openstreetmap.org/reverse",
        {
          params:  { format: "json", lat, lon: lng },
          headers: { "Accept-Language": "en" },
        }
      );
      const addr  = data.address ?? {};
      const label =
        addr.city        ||
        addr.city_district ||
        addr.town        ||
        addr.village     ||
        addr.county      ||
        addr.state       ||
        data.display_name?.split(",")[0] ||
        `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      setLocation({ lat, lng, label });
    } catch {
      // Geocoding failed — coordinates still set, label stays as coords
    } finally {
      setIsGeocoding(false);
    }
  }

  if (!leafletReady) {
    return (
      <div style={{
        height: 400, display: "flex", alignItems: "center",
        justifyContent: "center", background: "#f7fafc", color: "#a0aec0", fontSize: 14,
      }}>
        Loading map...
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      {/*
        key={instanceId} ensures React recreates the MapContainer DOM node
        (rather than reusing it) if this instance is unmounted and remounted.
        Leaflet throws "container reused" when it finds its internal _leaflet_id
        on a DOM node it did not initialise — a fresh DOM node avoids this.
      */}
      <MapContainer
        key={instanceId}
        center={[20.5937, 78.9629]}
        zoom={5}
        style={{ height: 400, width: "100%" }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> &copy; <a href="https://carto.com">CARTO</a>'
        />
        <ClickHandler onMapClick={handleMapClick} />
        {markerPos && (
          <Marker position={[markerPos.lat, markerPos.lng]} icon={iconRef.current} />
        )}
      </MapContainer>

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