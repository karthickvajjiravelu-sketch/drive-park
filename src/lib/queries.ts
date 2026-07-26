import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  role: "driver" | "landowner";
  verified: boolean;
  verification_status: "unverified" | "pending" | "approved" | "rejected";
  verification_note: string | null;
};

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export type Slot = {
  id: string;
  owner_id: string;
  name: string;
  approx_area: string;
  full_address: string;
  lat: number;
  lng: number;
  hourly_rate: number;
  daily_rate: number;
  monthly_rate: number;
  status: "open" | "full";
  vehicle_type: "car" | "bike" | "both";
  vehicle_size_limit: string;
  access_instructions: string;
  photos: string[];
  rating: number;
  covered: boolean;
  cctv: boolean;
  disabled_access: boolean;
  height_limit_cm: number | null;
  width_limit_cm: number | null;
  cancellation_policy: "flexible" | "moderate" | "strict";
};

export type Vehicle = {
  id: string;
  user_id: string;
  plate: string;
  make: string | null;
  colour: string | null;
  is_default: boolean;
};

export type Reservation = {
  id: string;
  driver_id: string;
  slot_id: string;
  start_time: string;
  end_time: string;
  status: "upcoming" | "active" | "completed" | "cancelled";
  total_price: number;
  rate_type: "hourly" | "daily" | "monthly";
  vehicle_id: string | null;
  vehicle_plate: string | null;
};

export const myVehiclesQuery = () => queryOptions({
  queryKey: ["my-vehicles"],
  queryFn: async (): Promise<Vehicle[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase.from("vehicles").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Vehicle[];
  },
});
export const useMyVehicles = () => useQuery(myVehiclesQuery());

export const profileQuery = () => queryOptions({
  queryKey: ["profile"],
  queryFn: async (): Promise<Profile | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return data as Profile | null;
  },
});
export const useProfile = () => useQuery(profileQuery());

export const slotsQuery = () => queryOptions({
  queryKey: ["slots"],
  queryFn: async (): Promise<Slot[]> => {
    const { data, error } = await supabase.from("slots").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Slot[];
  },
});
export const useSlots = () => useQuery(slotsQuery());

export const slotQuery = (id: string) => queryOptions({
  queryKey: ["slot", id],
  queryFn: async (): Promise<Slot | null> => {
    const { data, error } = await supabase.from("slots").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data as Slot | null;
  },
});
export const useSlot = (id: string) => useQuery(slotQuery(id));

export const mySlotsQuery = () => queryOptions({
  queryKey: ["my-slots"],
  queryFn: async (): Promise<Slot[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase.from("slots").select("*").eq("owner_id", user.id).order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Slot[];
  },
});
export const useMySlots = () => useQuery(mySlotsQuery());

export const myReservationsQuery = () => queryOptions({
  queryKey: ["my-reservations"],
  queryFn: async (): Promise<Array<Reservation & { slot: Slot | null }>> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("reservations")
      .select("*, slot:slots(*)")
      .eq("driver_id", user.id)
      .order("start_time", { ascending: false });
    if (error) throw error;
    return (data ?? []) as any;
  },
});
export const useMyReservations = () => useQuery(myReservationsQuery());

export const ownerBookingsQuery = () => queryOptions({
  queryKey: ["owner-bookings"],
  queryFn: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    // Get owner's slot IDs
    const { data: slots } = await supabase.from("slots").select("id, name").eq("owner_id", user.id);
    const slotIds = (slots ?? []).map(s => s.id);
    if (slotIds.length === 0) return [];
    const { data: reservations, error } = await supabase
      .from("reservations")
      .select("*")
      .in("slot_id", slotIds)
      .order("start_time", { ascending: false });
    if (error) throw error;
    // Fetch driver profiles
    const driverIds = [...new Set((reservations ?? []).map(r => r.driver_id))];
    const { data: drivers } = await supabase.from("profiles").select("user_id, name, phone").in("user_id", driverIds);
    const driverMap = new Map((drivers ?? []).map(d => [d.user_id, d]));
    const slotMap = new Map((slots ?? []).map(s => [s.id, s]));
    return (reservations ?? []).map(r => ({
      ...r,
      driver: driverMap.get(r.driver_id) ?? null,
      slot: slotMap.get(r.slot_id) ?? null,
    }));
  },
});
export const useOwnerBookings = () => useQuery(ownerBookingsQuery());

export const reviewsQuery = (slotId: string) => queryOptions({
  queryKey: ["reviews", slotId],
  queryFn: async () => {
    const { data, error } = await supabase.from("reviews").select("*").eq("slot_id", slotId).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
});
export const useReviews = (slotId: string) => useQuery(reviewsQuery(slotId));

export const notificationsQuery = () => queryOptions({
  queryKey: ["notifications"],
  queryFn: async (): Promise<Notification[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("notifications" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as unknown as Notification[];
  },
});
export const useNotifications = () => useQuery(notificationsQuery());

export const ownerProfileQuery = (ownerId: string) => queryOptions({
  queryKey: ["owner-profile", ownerId],
  queryFn: async (): Promise<Profile | null> => {
    const { data, error } = await supabase.from("profiles").select("*").eq("user_id", ownerId).maybeSingle();
    if (error) throw error;
    return data as Profile | null;
  },
});
export const useOwnerProfile = (ownerId: string) => useQuery(ownerProfileQuery(ownerId));

