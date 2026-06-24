document.addEventListener('DOMContentLoaded', function () {
    const toggleBtn = document.getElementById('togglePanelBtn');
    const panel = document.querySelector('.additional-panel');

    if (toggleBtn && panel) {
        toggleBtn.addEventListener('click', function () {
            const isOpen = panel.classList.toggle('open');
            const svg = toggleBtn.querySelector('svg');
            if (isOpen) {
                svg.innerHTML = `
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                `;
            } else {
                svg.innerHTML = `
                    <path d="M4 6h16M4 12h10M4 18h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                `;
            }
        });
    }
});

window.addEventListener('scroll', () => {
    document.getElementById('header').classList.toggle('scrolled', window.scrollY > 50);
});