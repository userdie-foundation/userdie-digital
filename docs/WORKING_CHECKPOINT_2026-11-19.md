# USERDIE Digital — рабочая точка на 19 ноября 2026 года

## Репозиторий и ветка
- Репозиторий: `userdie-foundation/userdie-digital`
- Основная ветка: `main`
- Базовый commit main: `a2066a7d8542efc20fe0d69dbe4f5f60a1b9640a`
- Рабочая ветка: `feature/valuation-workspace-api-integration`
- Последний подтверждённый commit: `31c2202ba1004baf09dca6d693c4d93784e64c22` (исправление теста origin header).
- Ветка опережает main на 21 коммит и не отстаёт от main (сравнение GitHub: ahead 21, behind 0).
- PR #29 остаётся открытым Draft, не объединён. Состояние подтверждено GitHub: `draft=true`, `merged=false`.

## Изменения 19.11.2026
1. В `website/prototype/workspace-api.js` добавлен сценарий повторной редакции документа со статусом `changes_requested`.
2. Форма загружает последнюю сохранённую версию через GET `/api/v1/analytical-documents/:id`, позволяет отредактировать разделы аналитического материала и отправляет новую версию через POST `/api/v1/analytical-documents/:id/versions`.
3. После сохранения интерфейс обновляет реестр; серверный маршрут версий уже реализован в backend и сохраняет историю, контроль SHA-256 и событие аудита.
4. В `backend/test/analytical-documents.test.mjs` добавлены тесты: доступ автора к содержимому последней версии и запрет создания версии пользователем без полномочий оценки активов.
5. Описание PR #29 обновлено, чтобы отразить новый сценарий и тесты.
6. По итогам Backend checks run #360 (`44486959764`) обнаружен один падающий тест: `analytical document version creation is denied without valuation authority`. Запрос без `Origin` блокировался middleware раньше проверки полномочий, поэтому тест ожидал 403, но получал `origin_not_allowed`.
7. Исправлен именно тестовый запрос: добавлен разрешённый `Origin: https://platform.example`, чтобы он проверял авторизацию, а не CORS. Commit исправления: `31c2202ba1004baf09dca6d693c4d93784e64c22`. Код backend не ослаблялся и не менялся.

## Проверки GitHub Actions
- Для commit `c3cc6e43675c7eebdc00fbafd3fe0dfb12337e5e`: Website Quality Gate, Public repository security check и USERDIE Security Guard завершились успешно; Backend checks на момент последней проверки выполнялся.
- Для checkpoint commit `dea614e282cf9680fc7fdf115858eb13fdbbc7d5`: Website Quality Gate run #400 завершился успешно; Public repository security check run #667 завершился успешно; USERDIE Security Guard run #953 завершился успешно (включая CodeQL); Backend checks run #360 завершился с одним упавшим тестом из-за отсутствующего Origin в тестовом запросе.
- После исправления в commit `31c2202ba1004baf09dca6d693c4d93784e64c22` повторный PR workflow пока не появился в доступной выборке GitHub Actions. Не считать исправление проверенным до нового успешного Backend checks run.
- Backend run `44486294317` для `b96f26b` завершился успешно: automated tests, production container build и smoke test — success.
- Не утверждать, что новые backend tests прошли, пока соответствующий workflow не завершится успешно.
- Отменённые Website Quality Gate и public security run на более раннем commit `3ec648b` были повторно успешно пройдены на последующих коммитах.

## Архитектурные и эксплуатационные ограничения
- API-origin остаётся пустым, включён demo mode; live API не активирован.
- Backend hosting, PostgreSQL, migrations 001–018, rate-limit secret, approved same-site API host/reverse proxy, точный ALLOWED_ORIGIN и persistent private PDF storage остаются предпосылками.
- Production deployment не подтверждён. Публичная публикация сайта этими изменениями не заявляется.
- PR #29 не сливать и Draft не снимать без отдельного подтверждения пользователя.
- DNS и MX/почтовые записи не изменять.

## Следующие действия
1. Добиться повторного запуска Backend checks для актуального commit `31c2202...` и подтвердить, что все 190 тестов проходят.
2. Проверить workflow run для актуального PR HEAD; не путать результаты `dea614e` и `31c2202`.
3. Проверить полный цикл: draft → submit → independent review → changes_requested → new version → resubmit → approved → issue → PDF.
4. Проверить миграции 001–018, изоляцию прав, хранение PDF и аудит в staging; инфраструктуру и бюджет не создавать без согласования.
5. После подтверждения CI обновить эту рабочую точку фактическими результатами.
