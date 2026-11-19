# USERDIE Digital — рабочая точка на 19 ноября 2026 года

## Репозиторий и PR
- Репозиторий: `userdie-foundation/userdie-digital`
- Основная ветка: `main`; base SHA: `a2066a7d8542efc20fe0d69dbe4f5f60a1b9640a`.
- Рабочая ветка: `feature/valuation-workspace-api-integration`.
- Последний commit с изменениями кода: `9330a65a878d5f58eb18802e66103b913d371961`.
- Предыдущие docs-only commits: `2bae8ec6abfe9832f59c7f91478e70e0e0012df1` и `325019369856cdcc1bc95b062b51355bbd3c074f`.
- PR #29: https://github.com/userdie-foundation/userdie-digital/pull/29
- PR открыт, Draft, не объединён; `main` не изменялась. Последняя проверка PR: `mergeable=true`, `merged=false`.

## Backend CI — исправление предыдущей ошибки
- Ошибка теста `analytical document version creation is denied without valuation authority` была вызвана тем, что тестовый HTTP-сервер не получал `allowedOrigin`, и middleware останавливал запрос на CORS до проверки полномочий.
- В `backend/test/analytical-documents.test.mjs` тесту задан разрешённый Origin и `allowedOrigin: "https://platform.example"`.
- Исправление: commit `613c150f6440fffe26301e6a28d0b00221505523`.
- На этом commit все четыре workflow завершились success: Backend checks run #363 (`44510144178`), Website Quality Gate #403 (`44510144193`), Public repository security check #670 (`44510144281`), USERDIE Security Guard #957 (`44510144263`, включая CodeQL).

## Проверка аналитических документов: lifecycle и PDF
Проверены:
- `backend/src/analytical-documents.mjs`
- `backend/src/analytical-document-pdf.mjs`
- `backend/test/analytical-documents.test.mjs`
- `backend/test/postgres-migrations.integration.test.mjs`
- migrations 016–018.

Подтверждено по коду и PostgreSQL integration coverage:
1. Версии содержания хранятся отдельными записями; UPDATE, DELETE и TRUNCATE блокируются триггерами миграции 016.
2. Независимое согласование привязано к точному `document_version_id`; автор и проверяющий должны различаться.
3. Миграция 017 фиксирует `approved_version_id` и `issued_version_id`; lifecycle trigger запрещает выпуск версии, отличной от одобренной.
4. Endpoint выпуска допускает только статус `approved`; транзакция блокирует запись и копирует `approved_version_id` в `issued_version_id`. Интеграционный тест проверяет конкурентные запросы: один 200 и один 409.
5. PDF endpoint выдаёт файл только для статуса `issued` и читает конкретную `issued_version_id`, а не последнюю версию по умолчанию.
6. PDF-артефакт хранится в частном файловом хранилище, связан с точной версией, имеет SHA-256 и проверку размера. Повторная загрузка возвращает идентичные байты.
7. Интеграционный тест проверяет отказ постороннему пользователю, успешную выдачу PDF, привязку к одобренной версии, повторную загрузку и события аудита генерации/скачивания.

Отдельный независимый penetration test не проводился; вывод выше — аудит реализации и существующего тестового покрытия.

## Новые изменения UI/API после lifecycle-аудита
- Обнаружен дефект: reviewer-only пользователь получал 403 на `/reviewers`, а общий `Promise.all` блокировал отображение доступного ему реестра.
- Исправлено в `website/prototype/workspace-api.js`: реестр загружается независимо; при отсутствии права создавать документы форма создания скрывается, но доступные документы продолжают отображаться.
- Backend list API теперь возвращает серверно вычисленные `canSubmit`, `canRevise`, `canReview`, `canIssue`, `canDownloadPdf`. UI показывает действия только по этим флагам, а не только по статусу карточки.
- Добавлены unit tests для действий автора и назначенного независимого проверяющего.
- Кодовые изменения находятся в commit `9330a65a878d5f58eb18802e66103b913d371961`.
- CI для этого commit: Website Quality Gate run #408 (`44511611329`) success; Public repository security check run #675 (`44511611368`) success; USERDIE Security Guard run #962 (`44511611260`) in progress; Backend checks run #368 (`44511611275`) pending/queued. Backend tests для этого commit ещё не подтверждены как пройденные.

## Эксплуатационные границы
- API-origin остаётся пустым, demo mode — режим по умолчанию.
- Backend hosting, PostgreSQL, migrations 001–018, login rate-limit secret, approved same-site API host/reverse proxy, точный ALLOWED_ORIGIN и persistent private PDF storage остаются эксплуатационными предпосылками.
- Production deployment не подтверждён; публикация сайта этими изменениями не заявляется.
- PR #29 не объединять и Draft не снимать без отдельного подтверждения пользователя.
- DNS и MX/почтовые записи не изменять.

## Следующие действия
1. Дождаться Backend checks run #368 и USERDIE Security Guard run #962 для commit `9330a65...`; при ошибке исправлять только подтверждённую причину.
2. После успешного CI перепроверить права и UI-сценарии по ролям, затем обновить PR/checkpoint с точными результатами.
3. Отдельно подготовить staging-проверку production runtime и private PDF storage после согласования инфраструктуры; не создавать ресурсы и расходы самостоятельно.
4. Сохранять PR #29 открытым Draft до отдельного решения пользователя.
