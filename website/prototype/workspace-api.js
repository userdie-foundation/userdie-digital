(() => {
  "use strict";
  if (window.__USERDIE_VALUATION_API_UI__) return;
  window.__USERDIE_VALUATION_API_UI__ = true;
  const root = "/api/v1/analytical-documents";
  const meta = document.querySelector('meta[name="userdie-api-origin"]');
  const configuredOrigin = (meta?.content || "").trim();
  let apiOrigin = "", busy = false, reviewers = [], documents = [], serverTasks = [], sessionReady = false;
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
    ".ud-api-doc{padding:13px;border:1px solid #dce1d6;border-radius:5px;background:white}.ud-api-doc-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.ud-api-doc strong{font:700 11px Manrope,sans-serif}.ud-api-doc p{margin:6px 0;color:#6d796e;font-size:10px;line-height:1.55;overflow-wrap:anywhere}.ud-api-doc-status{padding:5px 7px;border-radius:3px;background:#edf1e5;color:#4b6a47;font-size:8px;font-weight:800}.ud-api-doc-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.ud-api-detail{margin-top:12px;padding:12px;border-top:1px solid #e3e7df;background:#fbfaf6}.ud-api-detail h3{margin:10px 0 6px;color:#294b37;font:700 11px Manrope,sans-serif}.ud-api-detail p,.ud-api-detail li{color:#657367;font-size:10px;line-height:1.6;overflow-wrap:anywhere}.ud-api-detail ul{margin:5px 0;padding-left:18px}.ud-api-hash{font:9px ui-monospace,monospace;overflow-wrap:anywhere}",
    ".ud-server-task-panel{margin:0 0 18px;padding:18px;border:1px solid #cbd8be;border-radius:6px;background:#f7f9f2;color:#20372b}",
    ".ud-server-task-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px}",
    ".ud-server-task-head h3{margin:0;font:700 15px Manrope,sans-serif}.ud-server-task-head p{margin:5px 0 0;color:#6d796e;font-size:10px;line-height:1.6}",
    ".ud-server-task-state{padding:6px 8px;border-radius:3px;background:#f0eadb;color:#866b3d;font-size:8px;font-weight:800;letter-spacing:.5px}",
    ".ud-server-task-list{display:grid;gap:8px}.ud-server-task-card{padding:12px;border:1px solid #dce1d6;border-radius:4px;background:#fff}",
    ".ud-server-task-card header{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.ud-server-task-card strong{font:700 11px Manrope,sans-serif;color:#294833}",
    ".ud-server-task-meta{margin:6px 0 0;color:#6d796e;font-size:9px;line-height:1.6}.ud-server-task-overdue{color:#984b38;font-weight:800}",
    ".ud-server-task-empty{padding:16px;border:1px dashed #cbd6c2;border-radius:4px;color:#6d796e;font-size:10px;line-height:1.6}",
    ".ud-server-task-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}",
    ".ud-server-task-actions button{min-height:32px;padding:0 10px;border:1px solid #55764f;border-radius:4px;background:#fff;color:#31583d;font:700 9px DM Sans,sans-serif;cursor:pointer}",
    ".ud-server-task-actions button:disabled{opacity:.55;cursor:wait}",
    "@media(max-width:620px){.ud-server-task-panel{padding:14px}.ud-server-task-head{flex-direction:column}}",
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
  const taskPanel = document.createElement("section");
  taskPanel.className = "ud-server-task-panel";
  taskPanel.id = "ud-server-task-panel";
  taskPanel.setAttribute("aria-labelledby", "ud-server-task-title");
  taskPanel.innerHTML = '<div class="ud-server-task-head"><div><h3 id="ud-server-task-title">Серверная очередь задач</h3><p>Данные из PostgreSQL через защищённый API. Показываются только записи, разрешённые серверной ролью и областью доступа.</p></div><span class="ud-server-task-state" id="ud-server-task-state">НЕ ПОДКЛЮЧЕНО</span></div><div id="ud-server-task-list" class="ud-server-task-list" aria-live="polite"><div class="ud-server-task-empty">Серверная очередь пока не подключена. Локальные демонстрационные задачи остаются отдельно.</div></div><div class="ud-server-task-actions"><button id="ud-server-task-refresh" type="button" disabled>Обновить серверную очередь</button><span id="ud-server-task-feedback" class="ud-api-feedback" role="status" aria-live="polite"></span></div>';
  const taskView = document.getElementById("view-tasks");
  if (taskView) taskView.insertBefore(taskPanel, taskView.children[1] || null);
  const taskState = (label) => { const node=taskPanel.querySelector("#ud-server-task-state"); if(node)node.textContent=label; };
  const taskFeedback = (message, error=false) => { const node=taskPanel.querySelector("#ud-server-task-feedback"); if(node){node.textContent=message||"";node.classList.toggle("error",error);} };
  const renderServerTasks = () => {
    const host=taskPanel.querySelector("#ud-server-task-list");
    host.replaceChildren();
    if(!serverTasks.length){
      const empty=document.createElement("div");empty.className="ud-server-task-empty";
      empty.textContent="В разрешённой серверной очереди нет задач. Это не означает отсутствие задач в других областях доступа.";
      host.appendChild(empty);return;
    }
    const labels={open:"Открыта",in_progress:"В работе",blocked:"Заблокирована",completed:"Завершена",cancelled:"Отменена"};
    const priorities={critical:"Критический",high:"Высокий",normal:"Обычный",low:"Низкий"};
    serverTasks.forEach((task)=>{
      const card=document.createElement("article");card.className="ud-server-task-card";
      const head=document.createElement("header");
      const title=document.createElement("strong");title.textContent=task.title||"Задача без названия";
      const status=document.createElement("span");status.className="ud-api-doc-status";status.textContent=labels[task.status]||task.status||"Статус не указан";
      head.append(title,status);card.appendChild(head);
      const details=document.createElement("p");details.className="ud-server-task-meta";
      const due=task.dueAt?new Date(task.dueAt).toLocaleString("ru-RU",{dateStyle:"medium",timeStyle:"short"}):"Срок не задан";
      details.textContent=["Приоритет: "+(priorities[task.priority]||"Не указан"),"Срок: "+due,task.overdue?"Просрочена":"В срок",task.escalationLevel?"Уровень эскалации: "+task.escalationLevel:""].filter(Boolean).join(" · ");
      if(task.overdue)details.classList.add("ud-server-task-overdue");
      card.appendChild(details);
      const ref=document.createElement("p");ref.className="ud-server-task-meta";ref.textContent="Серверная запись · ID "+String(task.id||"").slice(0,8);
      card.appendChild(ref);
      const transitions={open:["in_progress","blocked","cancelled"],in_progress:["open","blocked","completed","cancelled"],blocked:["open","in_progress","cancelled"],completed:[],cancelled:[]};
      if(task.canUpdateStatus===true&&(transitions[task.status]||[]).length){
        const controls=document.createElement("div");controls.className="ud-server-task-actions";
        const select=document.createElement("select");select.setAttribute("aria-label","Новый статус задачи");
        const placeholder=document.createElement("option");placeholder.value="";placeholder.textContent="Изменить статус…";select.appendChild(placeholder);
        const nextLabels={open:"Открыта",in_progress:"В работе",blocked:"Заблокирована",completed:"Завершена",cancelled:"Отменена"};
        transitions[task.status].forEach((next)=>{const option=document.createElement("option");option.value=next;option.textContent=nextLabels[next];select.appendChild(option);});
        const save=document.createElement("button");save.type="button";save.textContent="Сохранить статус";save.disabled=true;
        select.addEventListener("change",()=>{save.disabled=!select.value;});
        save.addEventListener("click",()=>{if(select.value)updateServerTaskStatus(task.id,select.value,save);});
        controls.append(select,save);card.appendChild(controls);
      }
      host.appendChild(card);
    });
  };
  const updateServerTaskStatus = async (taskId, status, button) => {
    if(busy||!sessionReady)return;
    setBusy(true);button.disabled=true;taskState("СОХРАНЕНИЕ…");taskFeedback("Передаю изменение серверу; локальные данные не изменяются.");
    try{
      await json("/api/v1/workspace/tasks/"+encodeURIComponent(taskId)+"/status",{method:"PATCH",body:JSON.stringify({status})});
      await refreshWorkspaceTasks();
      taskFeedback("Сервер подтвердил изменение статуса задачи.");
    }catch(error){
      taskState("ИЗМЕНЕНИЕ НЕ ВЫПОЛНЕНО");taskFeedback(explain(error),true);
    }finally{setBusy(false);}
  };
  const refreshWorkspaceTasks = async () => {
    const refreshButton=taskPanel.querySelector("#ud-server-task-refresh");
    if(!apiOrigin){taskState("НЕ ПОДКЛЮЧЕНО");taskFeedback("Backend API-origin не задан. Сетевых запросов нет.");return;}
    if(!sessionReady){taskState("ТРЕБУЕТСЯ ВХОД");taskFeedback("Войдите в защищённый контур через форму авторизации в разделе «Активы и оценка».");return;}
    refreshButton.disabled=true;taskState("ЗАГРУЗКА…");taskFeedback("Получаю разрешённую очередь задач…");
    try{
      const data=await json("/api/v1/workspace/tasks?limit=50");
      serverTasks=Array.isArray(data.tasks)?data.tasks:[];
      renderServerTasks();taskState("СЕРВЕРНЫЕ ДАННЫЕ");taskFeedback("Получено записей: "+serverTasks.length+". Источник: серверный API.");
    }catch(error){
      serverTasks=[];renderServerTasks();
      if(error.status===401){sessionReady=false;taskState("СЕАНС НЕ АКТИВЕН");taskFeedback("Сеанс завершён или истёк. Войдите повторно.",true);$("ud-api-login").hidden=false;$("ud-api-workspace").hidden=true;}
      else if(error.status===403){taskState("НЕТ ДОСТУПА");taskFeedback("Для этой учётной записи сервер не разрешил просмотр очереди задач. Это ограничение роли или области доступа.",true);}
      else{taskState("СЕРВИС НЕДОСТУПЕН");taskFeedback(explain(error),true);}
    }finally{refreshButton.disabled=!sessionReady;}
  };
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
  const errorLabels = { authentication_required:"Требуется вход в систему.",invalid_credentials:"Не удалось войти: проверьте рабочую почту и пароль.",origin_not_allowed:"Backend не разрешил этот источник. Проверьте точный ALLOWED_ORIGIN.",authentication_unavailable:"Служба авторизации не настроена или недоступна.",analytical_document_reviewers_unavailable:"Список проверяющих временно недоступен.",analytical_document_reviewer_list_denied:"У этой учётной записи нет права создавать заключения.",
    task_status_transition_not_allowed:"Этот переход статуса запрещён текущим состоянием задачи.",not_found:"Задача не найдена или у учётной записи нет права её изменять.",workspace_unavailable:"Серверная очередь задач временно недоступна.",analytical_documents_unavailable:"Реестр документов временно недоступен.",analytical_document_write_unavailable:"Не удалось сохранить проект документа.",invalid_reviewer_assignment:"Выбранный проверяющий не имеет действующего права независимого согласования.",pdf_storage_unavailable:"Частное хранилище PDF не настроено. Выдача временно недоступна." };
  const explain = (error) => errorLabels[error.message] || ("Операция не выполнена: " + error.message);
  const addButton = (parent,label,action,secondary=true) => { const b=document.createElement("button");b.type="button";b.className="ud-api-btn"+(secondary?" secondary":"");b.textContent=label;b.addEventListener("click",action);parent.appendChild(b);return b; };
  const loadReviewers = async () => {
    const select=$("ud-api-reviewer");
    try {
      const data=await json(root+"/reviewers"); reviewers=Array.isArray(data.reviewers)?data.reviewers:[];
      select.replaceChildren();const first=document.createElement("option");first.value="";first.textContent=reviewers.length?"Выберите независимого проверяющего":"Нет доступных проверяющих";select.appendChild(first);
      reviewers.forEach((r)=>{const o=document.createElement("option");o.value=r.id;o.textContent=r.displayName;select.appendChild(o);});
      $("ud-api-create-form").hidden=false;
      return {ok:true};
    } catch(error) {
      reviewers=[];select.replaceChildren();const option=document.createElement("option");option.value="";option.textContent="Создание документа недоступно для этой роли";select.appendChild(option);
      $("ud-api-create-form").hidden=true;
      return {ok:false,error};
    }
  };
  const renderDocumentDetails = (host, data) => {
    host.replaceChildren();
    const doc=data.document||{};
    const addSection=(heading)=>{const h=document.createElement("h3");h.textContent=heading;host.appendChild(h);};
    const addParagraph=(value,className="")=>{const p=document.createElement("p");p.textContent=value||"—";if(className)p.className=className;host.appendChild(p);};
    addSection("Сведения о документе");
    addParagraph("Тип: "+(doc.documentType||"—")+" · Контур: "+(doc.organizationalContour||"—"));
    addParagraph("Создан: "+(doc.createdAt?new Date(doc.createdAt).toLocaleString("ru-RU"):"—")+" · Обновлён: "+(doc.updatedAt?new Date(doc.updatedAt).toLocaleString("ru-RU"):"—"));
    const versions=Array.isArray(data.versions)?data.versions:[];
    addSection("Версии и контроль целостности");
    if(!versions.length)addParagraph("Версии пока не зарегистрированы.");
    versions.forEach((version)=>{
      const item=document.createElement("p");
      const label=document.createElement("strong");label.textContent="Версия "+version.version_number+" · ";
      const hash=document.createElement("span");hash.className="ud-api-hash";hash.textContent="SHA-256 "+version.content_sha256;
      item.append(label,hash,document.createTextNode(" · "+(version.created_at?new Date(version.created_at).toLocaleString("ru-RU"):"")));
      host.appendChild(item);
    });
    addSection("Независимое согласование");
    const approvals=Array.isArray(data.approvals)?data.approvals:[];
    if(!approvals.length)addParagraph("Решение проверяющего ещё не зарегистрировано.");
    approvals.forEach((approval)=>{
      const decision=approval.status==="approved"?"Согласовано":approval.status==="changes_requested"?"Возвращено на доработку":"Ожидает решения";
      addParagraph(decision+" · "+(approval.decided_at?new Date(approval.decided_at).toLocaleString("ru-RU"):"ожидает")+" · "+(approval.decision_rationale||"Обоснование не указано"));
    });
    addSection("Журнал событий");
    const events=Array.isArray(data.events)?data.events:[];
    const labels={draft_created:"Создан проект",version_created:"Создана новая версия",submitted_for_review:"Передан на независимую проверку",approved:"Согласован",changes_requested:"Возвращён на доработку",issued:"Документ выпущен"};
    if(!events.length)addParagraph("Событий пока нет.");
    const list=document.createElement("ul");
    events.forEach((event)=>{
      const item=document.createElement("li");
      const transition=event.previous_status&&event.new_status?" · "+event.previous_status+" → "+event.new_status:"";
      const rationale=event.details?.rationale?" · "+event.details.rationale:"";
      item.textContent=(labels[event.event_type]||event.event_type)+transition+" · "+(event.created_at?new Date(event.created_at).toLocaleString("ru-RU"):"дата не указана")+rationale;
      list.appendChild(item);
    });
    if(events.length)host.appendChild(list);
  };
  const toggleDetails = async (id, card, button) => {
    const existing=card.querySelector(".ud-api-detail");
    if(existing){existing.remove();button.textContent="История и версии";return;}
    const detail=document.createElement("div");detail.className="ud-api-detail";detail.setAttribute("aria-live","polite");
    detail.textContent="Загружаю историю, версии и журнал событий…";card.appendChild(detail);button.textContent="Скрыть историю";
    try{const data=await json(root+"/"+encodeURIComponent(id));renderDocumentDetails(detail,data);}
    catch(error){detail.textContent=explain(error);detail.classList.add("error");}
  };
  const reviseDocument = async (doc, card) => {
    const existing = card.querySelector(".ud-api-revision");
    if (existing) { existing.remove(); return; }
    const editor = document.createElement("form");
    editor.className = "ud-api-detail ud-api-revision";
    editor.setAttribute("aria-label", "Новая версия аналитического документа");
    const heading = document.createElement("h3");
    heading.textContent = "Новая версия документа";
    editor.appendChild(heading);
    const note = document.createElement("p");
    note.textContent = "Сохраните исправленный материал. Предыдущая версия и замечания проверяющего останутся в истории.";
    editor.appendChild(note);
    const feedback = document.createElement("p");
    feedback.className = "ud-api-feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    const fields = [
      ["summary", "Краткое резюме", true],
      ["purpose", "Цель и границы анализа", false],
      ["methodology", "Методология и допущения", false],
      ["sources", "Источники и доказательная база", false],
      ["conclusion", "Основной вывод", false],
      ["limitations", "Ограничения и риски", false],
    ];
    const controls = {};
    try {
      const detail = await json(root + "/" + encodeURIComponent(doc.id));
      const latest = Array.isArray(detail.versions) ? detail.versions[0] : null;
      const previous = latest && latest.content && typeof latest.content === "object" ? latest.content : {};
      fields.forEach(([key, label, required]) => {
        const wrapper = document.createElement("label");
        wrapper.className = "ud-api-revision-field";
        wrapper.style.display = "grid";
        wrapper.style.gap = "6px";
        wrapper.style.margin = "10px 0";
        wrapper.style.color = "#687568";
        wrapper.style.fontSize = "10px";
        wrapper.style.fontWeight = "700";
        const caption = document.createElement("span");
        caption.textContent = label + (required ? " · обязательно" : "");
        const textarea = document.createElement("textarea");
        textarea.rows = key === "summary" || key === "conclusion" ? 3 : 2;
        textarea.maxLength = 8000;
        textarea.required = required;
        textarea.value = typeof previous[key] === "string" ? previous[key] : "";
        textarea.setAttribute("aria-label", label);
        textarea.style.boxSizing = "border-box";
        textarea.style.width = "100%";
        textarea.style.padding = "9px 10px";
        textarea.style.border = "1px solid #dce1d6";
        textarea.style.borderRadius = "4px";
        textarea.style.font = "11px/1.55 DM Sans,sans-serif";
        wrapper.append(caption, textarea);
        editor.appendChild(wrapper);
        controls[key] = textarea;
      });
      const actions = document.createElement("div");
      actions.className = "ud-api-doc-actions";
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "ud-api-btn";
      save.textContent = "Сохранить новую версию";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ud-api-btn secondary";
      cancel.textContent = "Отмена";
      cancel.addEventListener("click", () => editor.remove());
      actions.append(save, cancel);
      editor.append(actions, feedback);
      editor.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        const content = Object.fromEntries(fields.map(([key]) => [key, controls[key].value.trim()]));
        if (!content.summary) {
          feedback.textContent = "Заполните краткое резюме.";
          feedback.classList.add("error");
          controls.summary.focus();
          return;
        }
        setBusy(true);
        feedback.textContent = "Сохраняю новую версию в защищённом реестре…";
        feedback.classList.remove("error");
        try {
          await json(root + "/" + encodeURIComponent(doc.id) + "/versions", {
            method: "POST",
            body: JSON.stringify({ content }),
          });
          editor.remove();
          await refresh();
          state("Новая версия сохранена. Документ возвращён в статус черновика; можно повторно передать его независимому проверяющему.");
        } catch (error) {
          feedback.textContent = explain(error);
          feedback.classList.add("error");
        } finally {
          setBusy(false);
        }
      });
      card.appendChild(editor);
      controls.summary.focus();
    } catch (error) {
      state(explain(error), true);
    }
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
      let historyButton;
      historyButton=addButton(actions,"История и версии",()=>toggleDetails(doc.id,card,historyButton),true);
      if(doc.canSubmit===true)addButton(actions,"Передать на проверку",()=>transition(doc.id,"submit"),false);
      if(doc.canRevise===true)addButton(actions,"Подготовить новую версию",()=>reviseDocument(doc,card),false);
      if(doc.canReview===true){addButton(actions,"Согласовать",()=>decide(doc.id,"approved"),false);addButton(actions,"Вернуть на доработку",()=>decide(doc.id,"changes_requested"));}
      if(doc.canIssue===true)addButton(actions,"Зарегистрировать и выпустить",()=>transition(doc.id,"issue"),false);
      if(doc.canDownloadPdf===true)addButton(actions,"Скачать PDF",()=>downloadPdf(doc.id));
      card.appendChild(actions);host.appendChild(card);
    });
  };
  const refresh = async () => {
    setBusy(true);state("Загружаю реестр документов…");
    try {
      const docs=await json(root+"?limit=50");
      documents=Array.isArray(docs.documents)?docs.documents:[];
      const reviewerResult=await loadReviewers();
      renderDocuments();
      if(reviewerResult.ok)state("Реестр и список независимых проверяющих получены из защищённого API.");
      else if(reviewerResult.error.status===403)state("Реестр загружен. Для этой учётной записи доступен просмотр и назначенная независимая проверка; создание документов недоступно.");
      else state("Реестр загружен, но список проверяющих временно недоступен. Создание документов скрыто до восстановления сервиса.",true);
    }
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
    try{
      const response=await api(root+"/"+encodeURIComponent(id)+"/pdf");
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download="USERDIE-analytical-document.pdf";
      a.style.position="absolute";a.style.width="1px";a.style.height="1px";a.style.overflow="hidden";
      a.setAttribute("aria-label","Скачать выпущенное аналитическое заключение в формате PDF");
      document.body.appendChild(a);a.click();a.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);
      state("PDF получен через защищённый endpoint. Если загрузка не началась автоматически, повторите действие.");
    }catch(error){state(explain(error),true);}finally{setBusy(false);}
  };
  if(!configuredOrigin){
    $("ud-api-configuration").textContent="Демонстрационный режим. Backend API-origin пока не задан: кабинет не отправляет данные и не выполняет сетевые запросы. Для включения требуется утверждённый HTTPS-origin backend, совпадающий с его ALLOWED_ORIGIN, настроенная авторизация и частное хранилище PDF.";
    $("ud-api-login").hidden=true;$("ud-api-workspace").hidden=true;taskState("НЕ ПОДКЛЮЧЕНО");taskFeedback("Backend API-origin не задан. Серверные данные не запрашиваются.");
  }else{
    try{
      const parsed=new URL(configuredOrigin);
      if(parsed.origin!==configuredOrigin||(parsed.protocol!=="https:"&&parsed.hostname!=="localhost"&&parsed.hostname!=="127.0.0.1"))throw new Error("invalid origin");
      apiOrigin=parsed.origin;$("ud-api-state").textContent="API НАСТРОЕН · ВХОД НЕ ВЫПОЛНЕН";
      $("ud-api-configuration").textContent="Подключён адрес backend: "+apiOrigin+". Для доступа используйте персональную учётную запись. Данные будут передаваться только после успешной авторизации.";
      $("ud-api-login").hidden=false;
      $("ud-api-login-form").addEventListener("submit",async(event)=>{
        event.preventDefault();if(busy)return;setBusy(true);state("Проверяю учётные данные…");
        try{await json("/api/v1/auth/login",{method:"POST",body:JSON.stringify({email:$("ud-api-email").value.trim(),password:$("ud-api-password").value})});$("ud-api-password").value="";$("ud-api-login").hidden=true;$("ud-api-workspace").hidden=false;$("ud-api-state").textContent="ЗАЩИЩЁННЫЙ КОНТУР";$("ud-api-state").classList.add("live");sessionReady=true;taskPanel.querySelector("#ud-server-task-refresh").disabled=false;await refresh();await refreshWorkspaceTasks();}
        catch(error){state(explain(error),true);}finally{setBusy(false);}
      });
      $("ud-api-refresh").addEventListener("click",refresh);
      taskPanel.querySelector("#ud-server-task-refresh").addEventListener("click",refreshWorkspaceTasks);
      $("ud-api-logout").addEventListener("click",async()=>{
        setBusy(true);state("Завершаю защищённый серверный сеанс…");
        try{
          await api("/api/v1/auth/logout",{method:"POST",body:"{}"});
          documents=[];serverTasks=[];sessionReady=false;renderServerTasks();taskState("СЕАНС ЗАВЕРШЁН");taskFeedback("Серверный сеанс завершён; список очищен.");taskPanel.querySelector("#ud-server-task-refresh").disabled=true;$("ud-api-docs").replaceChildren();
          $("ud-api-workspace").hidden=true;$("ud-api-login").hidden=false;
          $("ud-api-state").textContent="СЕАНС ЗАВЕРШЁН";$("ud-api-state").classList.remove("live");
          state("Сервер подтвердил завершение сеанса.");
          $("ud-api-email").focus();
        }catch(error){
          state("Сервер не подтвердил выход. Рабочее пространство оставлено открытым; повторите попытку. "+explain(error),true);
        }finally{setBusy(false);}
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