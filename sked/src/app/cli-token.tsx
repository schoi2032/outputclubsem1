"use client";

import { useState } from "react";

export default function CliToken() {
  const [token, setToken] = useState("");

  async function make() {
    const res = await fetch("/api/cli-token", { method: "POST" });
    const data = await res.json();
    setToken(data.token ?? data.error);
  }

  return (
    <>
      <p className="label">Terminal app</p>
      {token ? (
        <>
          <p className="muted small-text">Run this once, it only shows now:</p>
          <code className="tok">sked login {token}</code>
        </>
      ) : (
        <button className="edit" onClick={make}>Get CLI login</button>
      )}
    </>
  );
}
