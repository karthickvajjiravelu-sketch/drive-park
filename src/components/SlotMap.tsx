import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import type { Slot } from "@/lib/queries";

// Custom yellow/gray pin (data URI SVG)
const makeIcon = (color: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #000;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><div style="width:10px;height:10px;background:#000;border-radius:50%;position:absolute;top:7px;left:7px"></div></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });

const openIcon = makeIcon("#FFD400");
const fullIcon = makeIcon("#999");

export default function SlotMap({
  slots,
  center,
  onSelect,
}: {
  slots: Slot[];
  center: [number, number];
  onSelect: (id: string) => void;
}) {
  const [key, setKey] = useState(0);
  useEffect(() => setKey(k => k + 1), []); // ensure fresh mount

  return (
    <MapContainer key={key} center={center} zoom={13} className="leaflet-container">
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {slots.map(s => (
        <Marker
          key={s.id}
          position={[s.lat, s.lng]}
          icon={s.status === "open" ? openIcon : fullIcon}
          eventHandlers={{ click: () => onSelect(s.id) }}
        >
          <Popup>
            <div className="font-semibold">{s.name}</div>
            <div className="text-xs">{s.approx_area}</div>
            <div className="text-xs mt-1">
              ₹{s.hourly_rate}/hr · {s.status === "open" ? "Open" : "Full"}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
