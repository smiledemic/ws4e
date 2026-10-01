document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("nes-btn");
  if (!btn) return;

  const img = btn.querySelector("img");
  const DEFAULT_PANIC_URL = "https://google.com";

  if (!localStorage.getItem("panicUrl")) {
    localStorage.setItem("panicUrl", DEFAULT_PANIC_URL);
  }

  let nesState = localStorage.getItem("nesState") || "norm";

  function updateUI() {
    img.src = nesState === "cartage"
      ? "assets/media/images/panic-btn/allow.png"
      : "assets/media/images/panic-btn/deny.png";
  }

  updateUI();

  btn.addEventListener("click", () => {
    nesState = nesState === "norm" ? "cartage" : "norm";
    localStorage.setItem("nesState", nesState);
    updateUI();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nesState === "cartage") {
      const panicUrl = localStorage.getItem("panicUrl") || DEFAULT_PANIC_URL;
      window.location.href = panicUrl;
    }
  });
});
