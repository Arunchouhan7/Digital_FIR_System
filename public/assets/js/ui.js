// Mobile navigation toggle
const navToggle = document.getElementById("navToggle");
const navMenu = document.getElementById("navMenu");

if (navToggle && navMenu) {
  if (!navMenu.querySelector(".nav-close")) {
    const closeBtn = document.createElement("button");
    closeBtn.className = "nav-close";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => navMenu.classList.remove("open"));
    navMenu.prepend(closeBtn);
  }
  navToggle.addEventListener("click", () => {
    navMenu.classList.toggle("open");
  });
  navMenu.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => navMenu.classList.remove("open"));
  });
}

// Highlight only the selected main navigation tab.
const mainTabHrefs = new Set(["fir.html", "track.html", "about.html", "contact.html"]);
const navButtons = Array.from(document.querySelectorAll("#navMenu .nav-btn"));
const currentPage = window.location.pathname.split("/").pop() || "index.html";

function setActiveNavButton(targetButton) {
  navButtons.forEach((btn) => {
    const href = (btn.getAttribute("href") || "").toLowerCase();
    if (!mainTabHrefs.has(href)) return;
    const isActive = btn === targetButton;
    btn.classList.toggle("active", isActive);
    if (isActive) {
      btn.setAttribute("aria-current", "page");
    } else {
      btn.removeAttribute("aria-current");
    }
  });
}

const currentButton = navButtons.find((btn) => {
  const href = (btn.getAttribute("href") || "").toLowerCase();
  return mainTabHrefs.has(href) && href === currentPage.toLowerCase();
});

if (currentButton) {
  setActiveNavButton(currentButton);
}

navButtons.forEach((btn) => {
  const href = (btn.getAttribute("href") || "").toLowerCase();
  if (!mainTabHrefs.has(href)) return;
  btn.addEventListener("click", () => setActiveNavButton(btn));
});
