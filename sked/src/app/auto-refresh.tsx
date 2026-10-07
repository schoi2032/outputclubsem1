"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60000);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
