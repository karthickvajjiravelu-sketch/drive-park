import { useEffect, useRef, useState } from "react";

export type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  /** If true, asks Razorpay to tokenize the card so it can be reused later. */
  token?: boolean;
  method?: { upi?: boolean; card?: boolean; netbanking?: boolean; wallet?: boolean; emi?: boolean; paylater?: boolean };
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: {
    ondismiss?: () => void;
    escape?: boolean;
    backdropclose?: boolean;
    confirm_close?: boolean;
  };
};

type RazorpayInstance = {
  open: () => void;
  close: () => void;
  on: (event: string, callback: (resp: { error?: { description?: string } }) => void) => void;
};

type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

export function useRazorpay() {
  const [ready, setReady] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.Razorpay) {
      setReady(true);
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => setReady(true);
    script.onerror = () => {
      loadingRef.current = false;
    };
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  const open = (options: RazorpayOptions, onFailed?: (message: string) => void) => {
    if (!window.Razorpay) return;
    const rzp = new window.Razorpay(options);
    rzp.on("payment.failed", (resp) => onFailed?.(resp?.error?.description || "Payment failed"));
    rzp.open();
  };

  return { ready, open };
}
