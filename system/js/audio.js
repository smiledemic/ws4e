(function () {
  let muted = localStorage.getItem("ws_muted") === "true";

  function applyMute() {
    document.querySelectorAll("audio, video").forEach(function (el) {
      el.muted = muted;
    });
  }

  window.WS_Audio = {
    setMuted: function (value) {
      muted = !!value;
      applyMute();
    },
    isMuted: function () {
      return muted;
    },
  };

  document.addEventListener("DOMContentLoaded", applyMute);

  const observer = new MutationObserver(applyMute);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
