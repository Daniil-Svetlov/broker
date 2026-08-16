window.addEventListener('scroll', () => {
    document.getElementById('header').classList.toggle('scrolled', window.scrollY > 50);
});

document.querySelectorAll('.drop-down-list').forEach(container => {
    const button = container.querySelector('.right-block');
    const submenu = container.querySelector('.submenu');
    button.addEventListener('click', () => {
        button.classList.toggle('open');
        submenu.classList.toggle('open');
    });
});