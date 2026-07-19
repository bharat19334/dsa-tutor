// ---------- Theme (dark / light) ----------
// Runs immediately (before paint) so the page never flashes the wrong theme.
// Default is dark unless the user has explicitly chosen light before.

(function () {
  const saved = localStorage.getItem("dsa_theme");
  const theme = saved === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
})();

// Wire up any .theme-toggle buttons on the page once the DOM is ready.
document.addEventListener("DOMContentLoaded", () => {
  const buttons = document.querySelectorAll(".theme-toggle");
  if (!buttons.length) return;

  function render() {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    buttons.forEach((btn) => {
      btn.innerHTML = isLight
        ? '<span class="icon">☀</span> light'
        : '<span class="icon">☾</span> dark';
    });
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const isLight = document.documentElement.getAttribute("data-theme") === "light";
      const next = isLight ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("dsa_theme", next);
      render();
    });
  });

  render();
});
