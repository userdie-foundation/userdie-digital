# USERDIE Digital — рабочая точка на 19 ноября 2026 года

## Репозиторий и PR
- Репозиторий: `userdie-foundation/userdie-digital`
- Основная ветка: `main`
- Base SHA: `a2066a7d8542efc20fe0d69dbe4f5f60a1b9640a`
- Рабочая ветка: `feature/valuation-workspace-api-integration`
- Последний подтверждённый HEAD: `613c150f6440fffe26301e6a28d0b00221505523`
- PR #29: https://github.com/userdie-foundation/userdie-digital/pull/29
- PR открыт, Draft, не объединён; GitHub показывает `mergeable=true`, `merged=false`.
- В PR: 23 коммита, 11 изменённых файлов (+557/-13) на момент проверки.
- `main` не изменялась.

## Исправление Backend CI
- Предыдущая ошибка теста `analytical document version creation is denied without valuation authority` была вызвана тем, что тестовый HTTP-сервер не получал `allowedOrigin`, и middleware останавливал запрос на CORS до проверки полномочий.
- Исправление внесено в `backend/test/analytical-documents.test.mjs`: разрешённый Origin оставлен в запросе и `allowedOrigin: "https://platform.example"` передан в `withServer`.
- Исправление находится в commit `613c150f6440fffe26301e6a28d0b00221505523`.
- Backend production-код и проверки безопасности не ослаблялись.

## GitHub Actions — подтверждено на HEAD 613c150...
Все четыре workflow для одного и того же commit завершились `completed / success`:
1. Backend checks run #363, ID `44510144178`: синтаксис, automated tests, production container build и smoke-test — success.
2. Website Quality Gate run #403, ID `44510144193` — success.
3. Public repository security check run #670, ID `44510144281` — success.
4. USERDIE Security Guard run #957, ID `44510144263`: secret-pattern scan, CodeQL JavaScript/TypeScript и security operating notes — success.

Это подтверждает CI на данном commit. Это не подтверждает production deployment или готовность live API.

## Проверка аналитических документов: lifecycle и PDF
Проведён аудит:
- `backend/src/analytical-documents.mjs`
- `backend/src/analytical-document-pdf.mjs`
- `backend/test/analytical-documents.test.mjs`
- `backend/test/postgres-migrations.integration.test.mjs`
- migrations 016–018.

Подтверждено по коду и PostgreSQL integration coverage:
1. Версии содержания создаются как отдельные записи; UPDATE, DELETE и TRUNCATE для таблицы версий блокируются триггерами миграции 016.
2. Независимое согласование привязано к точному `document_version_id`; автор и проверяющий должны различаться.
3. Миграция 017 фиксирует `approved_version_id` и `issued_version_id`, а lifecycle trigger запрещает выпуск версии, отличной от одобренной.
4. Endpoint выпуска допускает только статус `approved`; транзакция блокирует запись документа и копирует `approved_version_id` в `issued_version_id`. Конкурентные запросы на выпуск проверяются интеграционным тестом: ожидаются один ответ 200 и один 409.
5. PDF endpoint выдаёт файл только для документа со статусом `issued` и читает конкретную `issued_version_id`, а не произвольную последнюю версию.
6. PDF-артефакт хранится вне публичного web-root, с ограничением размера, SHA-256 и размером в БД; повторная загрузка должна вернуть идентичные байты. Миграция 018 связывает артефакт с точной неизменяемой версией.
7. Интеграционный тест проверяет запрет PDF для постороннего пользователя, успешную выдачу PDF, привязку артефакта к пересмотренной и одобренной версии, неизменность повторной загрузки и audit events генерации/скачивания.

По результатам чтения кода и тестов существенного дефекта в связке approved version → issued version → PDF не обнаружено. Это аудит реализации и тестового покрытия; отдельный независимый penetration test не проводился.

## Эксплуатационные границы
- API-origin остаётся пустым, demo mode остаётся режимом по умолчанию.
- Backend hosting, PostgreSQL, migrations 001–018, login rate-limit secret, approved same-site API host/reverse proxy, точный ALLOWED_ORIGIN и persistent private PDF storage остаются эксплуатационными предпосылками.
- Production deployment не подтверждён; публичная публикация сайта этими изменениями не заявляется.
- PR #29 не объединять и Draft не снимать без отдельного подтверждения пользователя.
- DNS и MX/почтовые записи не изменять.

## Следующие инженерные шаги
1. Проверить визуальную связку workspace UI и API adapter: состояния авторизации, ошибки, доступность кнопок по ролям, мобильный сценарий и сообщения о статусах.
2. Проверить настройки production runtime и private PDF storage на отдельном staging-контуре после согласования инфраструктуры; не создавать ресурсы и расходы самостоятельно.
3. После UI-аудита подготовить следующий ограниченный набор улучшений в той же feature-ветке, затем повторить CI.
4. Сохранять PR #29 открытым Draft до отдельного решения пользователя.
