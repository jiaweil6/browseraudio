// nav.js — the phone-width menu. Loaded in <head> so the page is marked as
// scripted before it paints (the CSS collapses the links only then); the
// toggle is wired once the nav exists.
(function () {
  "use strict";
  document.documentElement.classList.add("js");

  function wire() {
    var nav = document.querySelector(".nav");
    var btn = nav && nav.querySelector(".nav-toggle");
    if (!btn) return;
    var label = btn.querySelector("span");

    function set(open) {
      nav.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
      if (label) label.textContent = open ? "Close" : "Menu";
    }

    btn.addEventListener("click", function () {
      set(!nav.classList.contains("open"));
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        set(false);
        btn.focus();
      }
    });
    document.addEventListener("click", function (e) {
      if (nav.classList.contains("open") && !nav.contains(e.target)) set(false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
