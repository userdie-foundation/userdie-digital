(() => {
  "use strict";
  const apiMeta = document.querySelector('meta[name="userdie-api-base"]');
  const form = document.querySelector("[data-recovery-form]");
  const status = document.querySelector("[data-status]");
  const submit = form?.querySelector('button[type="submit"]');
  if (!form || !status || !submit) return;

  const announce = (message, kind = "info") => {
    status.textContent = message;
    status.dataset.kind = kind;
  };
  const tokenField = form.querySelector('[name="token"]');
  let recoveryToken = null;
  if (tokenField) {
    const params = new URLSearchParams(window.location.search);
    const supplied = params.get("token") ?? "";
    // Remove the one-time secret from the visible URL and browser history immediately.
    window.history.replaceState(null, "", window.location.pathname);
    if (/^[A-Za-z0-9_-]{43}$/.test(supplied)) {
      recoveryToken = supplied;
      tokenField.value = supplied;
    } else {
      form.hidden = true;
      announce("Ссылка восстановления отсутствует или имеет неверный формат. Запросите новое письмо.", "error");
      return;
    }
  }

  const apiBaseValue = apiMeta?.content?.trim() ?? "";
  let apiBase = "";
  try {
    const parsed = new URL(apiBaseValue);
    if (parsed.protocol === "https:" && parsed.origin === apiBaseValue.replace(/\/$/, "") &&
        !parsed.username && !parsed.password && parsed.pathname === "/" &&
        !parsed.search && !parsed.hash) apiBase = parsed.origin;
  } catch {}
  if (!apiBase) {
    form.hidden = true;
    submit.disabled = true;
    announce("Сервис восстановления пока не подключён к серверу фонда. Форма временно закрыта. Не вводите здесь пароль или другие конфиденциальные данные.", "error");
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled || !form.reportValidity()) return;
    const data = new FormData(form);
    const payload = tokenField
      ? { token: recoveryToken, newPassword: String(data.get("newPassword") ?? "") }
      : { email: String(data.get("email") ?? "").trim() };
    if (tokenField) {
      const confirmation = String(data.get("confirmPassword") ?? "");
      if (payload.newPassword !== confirmation) {
        announce("Пароли не совпадают. Проверьте оба поля.", "error");
        form.querySelector('[name="confirmPassword"]')?.focus();
        return;
      }
      if (new TextEncoder().encode(payload.newPassword).length < 12 ||
          new TextEncoder().encode(payload.newPassword).length > 1024) {
        announce("Новый пароль должен содержать не менее 12 символов.", "error");
        return;
      }
    }
    submit.disabled = true;
    submit.textContent = "Обрабатываем запрос…";
    announce("");
    try {
      const response = await fetch(apiBase + (tokenField
        ? "/api/v1/auth/recovery/complete"
        : "/api/v1/auth/recovery/request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const result = await response.json().catch(() => ({}));
      if (!tokenField && response.status === 202 && result.accepted === true) {
        form.reset();
        announce("Если учётная запись с таким адресом существует, письмо с дальнейшими инструкциями будет отправлено. Проверьте входящие и папку «Спам».", "success");
      } else if (tokenField && response.status === 200 && result.reset === true) {
        form.reset();
        recoveryToken = null;
        form.hidden = true;
        announce("Пароль успешно изменён. Все прежние активные сессии отозваны. Теперь можно вернуться к входу.", "success");
      } else if (response.status === 400 && tokenField) {
        form.hidden = true;
        recoveryToken = null;
        announce("Ссылка недействительна, уже использована или срок её действия истёк. Запросите новое письмо.", "error");
      } else if (response.status === 429) {
        announce("Слишком много попыток. Подождите и повторите запрос позже.", "error");
      } else {
        announce("Сервис временно недоступен. Попробуйте позднее.", "error");
      }
    } catch {
      announce("Не удалось связаться с сервером. Попробуйте позднее.", "error");
    } finally {
      if (!form.hidden) {
        submit.disabled = false;
        submit.textContent = tokenField ? "Сохранить новый пароль" : "Отправить инструкцию";
      }
    }
  });
})();
