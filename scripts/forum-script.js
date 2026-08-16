window.addEventListener('scroll', () => {
    document.getElementById('header').classList.toggle('scrolled', window.scrollY > 50);
});

document.querySelectorAll('.drop-down-list').forEach(container => {
    const button = container.querySelector('.block');
    const submenu = container.querySelector('.submenu');
    button.addEventListener('click', () => {
        button.classList.toggle('open');
        submenu.classList.toggle('open');
    });
});

document.querySelectorAll('.filter-btn').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelector('.filter-btn.active')?.classList.remove('active');
        button.classList.add('active');
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const heartButtons = document.querySelectorAll('.footer-pill:has(.heart-icon)');
    heartButtons.forEach(button => {
        button.addEventListener('click', () => {
            button.classList.toggle('active');
        });
    });
});
