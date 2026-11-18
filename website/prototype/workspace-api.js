(() => {
  "use strict";
  if (window.__USERDIE_VALUATION_API_UI__) return;
  window.__USERDIE_VALUATION_API_UI__ = true;
  const root = "/api/v1/analytical-documents";
  const meta = document.querySelector('meta[name="userdie-api-origin"]');
  const configuredOrigin = (meta?.content || "").trim();
  let apiOrigin = "", busy = false, reviewers = [], documents = [];
  const style = document.createElement("style");
  style.textContent = [
    ".ud-api-panel{margin:18px 0;padding:22px;border:1px solid #dce1d6;border-radius:6px;background:#fbfaf6;color:#20372b}",
    ".ud-api-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px}",
    ".ud-api-head h2{margin:0;font:700 18px Manrope,sans-serif}.ud-api-head p{margin:6px 0 0;color:#6d796e;font-size:11px;line-height:1.6}",
    ".ud-api-state{padding:7px 9px;border-radius:4px;background:#f0eadb;color:#866b3d;font-size:9px;font-weight:800;letter-spacing:.5px}.ud-api-state.live{background:#e5eddb;color:#4d7047}",
    ".ud-api-note{margin:12px 0;padding:12px 14px;border-left:3px solid #c4a16f;background:#f3efe5;color:#74664f;font-size:10px;line-height:1.7}",
    ".ud-api-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:15px 0}.ud-api-form label{display:grid;gap:6px;color:#687568;font-size:10px;font-weight:700}.ud-api-form .wide{grid-column:1/-1}",
    ".ud-api-form input,.ud-api-form select,.ud-api-form textarea{box-sizing:border-box;width:100%;min-width:0;min-height:38px;padding:9px 10px;border:1px solid #dce1d6;border-radius:4px;background:#fff;color:#20372b;font:11px DM Sans,sans-serif}.ud-api-form textarea{min-height:72px;resize:vertical;line-height:1.55}",
    ".ud-api-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ud-api-btn{min-height:36px;padding:0 12px;border:1px solid #2c553e;border-radius:4px;background:#2c553e;color:white;font:700 10px DM Sans,sans-serif;cursor:pointer}.ud-api-btn.secondary{background:white;color:#2c553e}.ud-api-btn:disabled{opacity:.55;cursor:wait}",
    ".ud-api-feedback{margin:10px 0;color:#59695a;font-size:10px;line-height:1.6;white-space:pre-wrap}.ud-api-feedback.error{color:#9a4938}.ud-api-docs{display:grid;gap:9px;margin-top:14px}",
    ".ud-api-doc{padding:13px;border:1px solid #dce1d6;border-radius:5px;background:white}.ud-api-doc-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.ud-api-doc strong{font:700 11px Manrope,sans-serif}.ud-api-doc p{margin:6px 0;color:#6d796e;font-size:10px;line-height:1.55;overflow-wrap:anywhere}.ud-api-doc-status{padding:5px 7px;border-radius:3px;background:#edf1e5;color:#4b6a47;font-size:8px;font-weight:800}.ud-api-doc-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}",
    "@media(max-width:620px){.ud-api-panel{padding:15px}.ud-api-form{grid-template-columns:1fr}.ud-api-form .wide{grid-column:auto}.ud-api-head{flex-direction:column}}"
  ].join("");
  document.head.appendChild(style);
  const panel = document.createElement("section");
  panel.className = "ud-api-panel"; panel.id = "valuation-api-workspace";
  panel.setAttribute("aria-labelledby", "ud-api-title");
  panel.innerHTML = '<div class="ud-api-head"><div><h2 id="ud-api-title">Реестр аналитических заключений</h2><p>Защищённый контур Центра оценки активов · версии, независимая проверка и выдача PDF</p></div><span class="ud-api-state" id="ud-api-state">ДЕМО-РЕЖИМ</span></div><div id="ud-api-configuration" class="ud-api-note"></div><div id="ud-api-login" hidden><form class="ud-api-form" id="ud-api-login-form"><label>Рабочая почта<input id="ud-api-email" type="email" autocomplete="username" required maxlength="254"></label><label>Пароль<input id="ud-api-password" type="password" autocomplete="current-password" required maxlength="1024"></label><div class="wide ud-api-actions"><button class="ud-api-btn" type="submit">Войти в защищённый контур</button></div></form></div><div id="ud-api-workspace" hidden><div class="ud-api-actions"><button class="ud-api-btn secondary" id="ud-api-refresh" type="button">Обновить реестр</button><button class="ud-api-btn secondary" id="ud-api-logout" type="button">Выйти</button></div><form class="ud-api-form" id="ud-api-create-form"><label>Тип документа<select id="ud-api-type" required><option value="asset_analysis">Аналитическое заключение об активе</option><option value="preliminary_valuation">Предварительное оценочное заключение</option><option value="investment_analysis">Инвестиционно-аналитическое заключение</option><option value="capital_structure_analysis">Структура капитала и долговая нагрузка</option></select></label><label>Независимый проверяющий<select id="ud-api-reviewer" required><option value="">Загрузка списка проверяющих…</option></select></label><label class="wide">Название документа<input id="ud-api-title-field" required minlength="3" maxlength="240" placeholder="Например: Аналитическое заключение по объекту"></label><label>Идентификатор / объект актива<input id="ud-api-asset" maxlength="128" placeholder="Внутренний код или описание"></label><label>Краткое резюме<textarea id="ud-api-summary" maxlength="8000" required></textarea></label><label>Цель и границы анализа<textarea id="ud-api-purpose" maxlength="8000"></textarea></label><label>Методология и допущения<textarea id="ud-api-method" maxlength="8000"></textarea></label><label>Источники и доказательная база<textarea id="ud-api-sources" maxlength="8000"></textarea></label><label>Основной вывод<textarea id="ud-api-conclusion" maxlength="8000"></textarea></label><label>Ограничения и риски<textarea id="ud-api-limitations" maxlength="8000"></textarea></label><div class="wide ud-api-note">Содержимое отправляется только на явно настроенный API-origin после входа. В демонстрационном режиме данные этой формы не собираются и не сохраняются.</div><div class="wide ud-api-actions"><button class="ud-api-btn" type="submit">Создать защищённый проект документа</button></div></form><div class="ud-api-head"><div><h2>Документы и статусы</h2><p>Список ограничен серверными правами текущей учётной записи.</p></div></div><div id="ud-api-docs" class="ud-api-docs" aria-live="polite"></div></div><div id="ud-api-feedback" class="ud-api-feedback" role="status" aria-live="polite"></div>';
  const reportPanel = document.getElementById("ib-report-form")?.closest(".panel");
  const assetsView = document.getElementById("view-assets");
  if (reportPanel?.parentElement) reportPanel.insertAdjacentElement("afterend", panel);
  else if (assetsView) assetsView.appendChild(panel);
  else document.querySelector(".app-main")?.appendChild(panel);
  const $ = (id) => panel.querySelector("#" + id);
  const state = (message, error = false) => { $("ud-api-feedback").textContent = message || ""; $("ud-api-feedback").classList.toggle("error", error); };
  const setBusy = (value) => { busy = value; panel.querySelectorAll("button").forEach((button) => { button.disabled = value; }); };
  const api = async (path, options = {}) => {
    const response = await fetch(apiOrigin + path, { ...options, credentials: "include", headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
    if (!response.ok) {
      let code = "HTTP " + response.status; try { code = (await response.json()).error || code; } catch {}
      const error = new Error(code); error.status = response.status; throw error;
    }
    if (response.status === 204) return null;
    return response;
  };
  const json = async (path, options) => (await api(path, options)).json();
  const statusLabels = { draft:"Черновик",submitted_for_review:"На независимой проверке",changes_requested:"Требуются изменения",approved:"Согласовано",issued:"Выпущено",archived:"В архиве" };
  const errorLabels = { authentication_required:"Требуется вход в систему.",invalid_credentials:"Не удалось войти: проверьте рабочую почту и пароль.",origin_not_allowed:"Backend не разрешил этот источник. Проверьте точный ALLOWED_ORIGIN.",authentication_unavailable:"Служба авторизации не настроена или недоступна.",analytical_document_reviewers_unavailable:"Список проверяющих временно недоступен.",analytical_document_reviewer_list_denied:"У этой учётной записи нет права создавать заключения.",analytical_documents_unavailable:"Реестр документов временно недоступен.",analytical_document_write_unavailable:"Не удалось сохранить проект документа.",invalid_reviewer_assignment:"Выбранный проверяющий не имеет действующего права независимого согласования.",pdf_storage_unavailable:"Частное хранилище PDF не настроено. Выдача временно недоступна." };
  const explain = (error) => errorLabels[error.message] || ("Операция не выполнена: " + error.message);
  const addButton = (parent,label,action,secondary=true) => { const b=document.createElement("button");b.type="button";b.className="ud-api-btn"+(secondary?" secondary":"");b.textContent=label;b.addEventListener("click",action);parent.appendChild(b); };
  const loadReviewers = async () => {
    const data=await json(root+"/reviewers"); reviewers=Array.isArray(data.reviewers)?data.reviewers:[];
    const select=$("ud-api-reviewer");select.replaceChildren();const first=document.createElement("option");first.value="";first.textContent=reviewers.length?"Выберите независимого проверяющего":"Нет доступных проверяющих";select.appendChild(first);
    reviewers.forEach((r)=>{const o=document.createElement("option");o.value=r.id;o.textContent=r.displayName;select.appendChild(o);});
  };
  const renderDocuments = () => {
    const host=$("ud-api-docs");host.replaceChildren();
    if(!documents.length){const p=document.createElement("p");p.className="ud-api-feedback";p.textContent="В доступном для вашей роли контуре пока нет документов.";host.appendChild(p);return;}
    documents.forEach((doc)=>{
      const card=document.createElement("article");card.className="ud-api-doc";
      const head=document.createElement("div");head.className="ud-api-doc-head";
      const title=document.createElement("strong");title.textContent=doc.title||"Без названия";
      const status=document.createElement("span");status.className="ud-api-doc-status";status.textContent=statusLabels[doc.status]||doc.status;head.append(title,status);card.appendChild(head);
      const meta=document.createElement("p");meta.textContent=[doc.documentNumber,doc.assetReference,doc.updatedAt?new Date(doc.updatedAt).toLocaleString("ru-RU"):""].filter(Boolean).join(" · ")||"Регистрационный номер присваивается только при выпуске.";card.appendChild(meta);
      const actions=document.createElement("div");actions.className="ud-api-doc-actions";
      if(doc.status==="draft")addButton(actions,"Передать на проверку",()=>transition(doc.id,"submit"),false);
      if(doc.status==="submitted_for_review"){addButton(actions,"Согласовать",()=>decide(doc.id,"approved"),false);addButton(actions,"Вернуть на доработку",()=>decide(doc.id,"changes_requested"));}
      if(doc.status==="approved")addButton(actions,"Зарегистрировать и выпустить",()=>transition(doc.id,"issue"),false);
      if(doc.status==="issued")addButton(actions,"Скачать PDF",()=>downloadPdf(doc.id));
      if(actions.childElementCount)card.appendChild(actions);host.appendChild(card);
    });
  };
  const refresh = async () => {
    setBusy(true);state("Загружаю реестр и список проверяющих…");
    try { const [docs]=await Promise.all([json(root+"?limit=50"),loadReviewers()]);documents=Array.isArray(docs.documents)?docs.documents:[];renderDocuments();state("Данные получены из защищённого API."); }
    catch(error){if(error.status===401){$("ud-api-login").hidden=false;$("ud-api-workspace").hidden=true;}state(explain(error),true);}
    finally{setBusy(false);}
  };
  const transition = async (id,action) => {
    setBusy(true);state("Выполняется операция…");
    try{await json(root+"/"+encodeURIComponent(id)+"/"+action,{method:"POST",body:"{}"});await refresh();state("Статус документа обновлён сервером.");}
    catch(error){state(explain(error),true);}finally{setBusy(false);}
  };
  const decide = async (id,decision) => {
    const rationale=window.prompt(decision==="approved"?"Обоснование независимого согласования:":"Укажите замечания и необходимые изменения:");
    if(!rationale||rationale.trim().length<3){state("Решение не отправлено: необходимо обоснование не короче 3 символов.");return;}
    setBusy(true);try{await json(root+"/"+encodeURIComponent(id)+"/decision",{method:"POST",body:JSON.stringify({decision,rationale:rationale.trim()})});await refresh();state("Решение независимого проверяющего зарегистрировано.");}
    catch(error){state(explain(error),true);}finally{setBusy(false);}
  };
  const downloadPdf = async (id) => {
    setBusy(true);state("Проверяю право доступа и целостность PDF…");
    try{const response=await api(root+"/"+encodeURIComponent(id)+"/pdf");const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="USERDIE-analytical-document.pdf";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);state("PDF получен через защищённый endpoint.");}
    catch(error){state(explain(error),true);}finally{setBusy(false);}
  };
  if(!configuredOrigin){
    $("ud-api-configuration").textContent="Демонстрационный режим. Backend API-origin пока не задан: кабинет не отправляет данные и не выполняет сетевые запросы. Для включения требуется утверждённый HTTPS-origin backend, совпадающий с его ALLOWED_ORIGIN, настроенная авторизация и частное хранилище PDF.";
    $("ud-api-login").hidden=true;$("ud-api-workspace").hidden=true;
  }else{
    try{
      const parsed=new URL(configuredOrigin);
      if(parsed.origin!==configuredOrigin||(parsed.protocol!=="https:"&&parsed.hostname!=="localhost"&&parsed.hostname!=="127.0.0.1"))throw new Error("invalid origin");
      apiOrigin=parsed.origin;$("ud-api-state").textContent="API НАСТРОЕН · ВХОД НЕ ВЫПОЛНЕН";
      $("ud-api-configuration").textContent="Подключён адрес backend: "+apiOrigin+". Для доступа используйте персональную учётную запись. Данные будут передаваться только после успешной авторизации.";
      $("ud-api-login").hidden=false;
      $("ud-api-login-form").addEventListener("submit",async(event)=>{
        event.preventDefault();if(busy)return;setBusy(true);state("Проверяю учётные данные…");
        try{await json("/api/v1/auth/login",{method:"POST",body:JSON.stringify({email:$("ud-api-email").value.trim(),password:$("ud-api-password").value})});$("ud-api-password").value="";$("ud-api-login").hidden=true;$("ud-api-workspace").hidden=false;$("ud-api-state").textContent="ЗАЩИЩЁННЫЙ КОНТУР";$("ud-api-state").classList.add("live");await refresh();}
        catch(error){state(explain(error),true);}finally{setBusy(false);}
      });
      $("ud-api-refresh").addEventListener("click",refresh);
      $("ud-api-logout").addEventListener("click",async()=>{
        setBusy(true);try{await api("/api/v1/auth/logout",{method:"POST",body:"{}"});}catch(error){state(explain(error),true);}
        documents=[];$("ud-api-workspace").hidden=true;$("ud-api-login").hidden=false;$("ud-api-state").textContent="СЕАНС ЗАВЕРШЁН";$("ud-api-state").classList.remove("live");setBusy(false);
      });
      $("ud-api-create-form").addEventListener("submit",async(event)=>{
        event.preventDefault();if(busy)return;const reviewerId=$("ud-api-reviewer").value;
        if(!reviewerId){state("Выберите независимого проверяющего.");return;}
        const content={summary:$("ud-api-summary").value.trim(),purpose:$("ud-api-purpose").value.trim(),methodology:$("ud-api-method").value.trim(),sources:$("ud-api-sources").value.trim(),conclusion:$("ud-api-conclusion").value.trim(),limitations:$("ud-api-limitations").value.trim()};
        if(!content.summary){state("Заполните краткое резюме.");return;}
        setBusy(true);state("Создаю проект в серверном реестре…");
        try{await json(root,{method:"POST",body:JSON.stringify({documentType:$("ud-api-type").value,organizationalContour:"assets",assetReference:$("ud-api-asset").value.trim()||undefined,title:$("ud-api-title-field").value.trim(),reviewerId,content})});$("ud-api-create-form").reset();await refresh();state("Проект создан в серверном реестре. Регистрационный номер появится только после согласования и выпуска.");}
        catch(error){state(explain(error),true);}finally{setBusy(false);}
      });
    }catch{
      $("ud-api-state").textContent="ОШИБКА КОНФИГУРАЦИИ";$("ud-api-configuration").textContent="API-origin некорректен. Требуется абсолютный HTTPS-origin без пути; соединение отключено.";$("ud-api-login").hidden=true;
    }
  }
})();