function showError(inputElement, message) {
    const group = inputElement.parentElement;
    const errorSpan = group.querySelector('.error-message');
    group.classList.add('invalid');
    errorSpan.innerText = message;
}

function clearError(inputElement) {
    const group = inputElement.parentElement;
    group.classList.remove('invalid');
}

function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const nameInput = document.getElementById('userName');
    const emailInput = document.getElementById('userEmail');
    const messageInput = document.getElementById('userMessage');
    
    clearError(nameInput);
    clearError(emailInput);
    clearError(messageInput);
    let isValid = true;
    if (nameInput.value.trim() === '') {
        showError(nameInput, 'Пожалуйста, введите ваше имя');
        isValid = false;
    } else if (nameInput.value.trim().length < 4) {
        showError(nameInput, 'Имя должно содержать минимум 4 символа');
        isValid = false;
    }
    const emailRegex = /^[^\s@]+@[^\s@.]+\.[^\s@.]+$/;
    if (emailInput.value.trim() === '') {
        showError(emailInput, 'Введите адрес электронной почты');
        isValid = false;
    } else if (!emailRegex.test(emailInput.value.trim())) {
        showError(emailInput, 'Введите корректный адрес электронной почты');
        isValid = false;
    }
    if (messageInput.value.trim() === '') {
        showError(messageInput, 'Опишите вашу проблему');
        isValid = false;
    } else if (messageInput.value.trim().length < 10) {
        showError(messageInput, 'Описание должно содержать минимум 10 символов');
        isValid = false;
    }
    if (!isValid) return;
    console.log('Данные к отправке:', nameInput.value.trim(), emailInput.value.trim(), messageInput.value.trim()); 
    const btn = form.querySelector('.submit-btn');
    const btnText = btn.querySelector('span');
    const originalText = btnText.innerText;
    btnText.innerText = 'Отправлено!';
    btn.classList.add('success');
    form.reset(); 
    setTimeout(() => {
        btnText.innerText = originalText;
        btn.classList.remove('success');
    }, 3000);
}
document.querySelectorAll('.input-group input, .input-group textarea').forEach(element => {
    element.addEventListener('input', () => clearError(element));
});