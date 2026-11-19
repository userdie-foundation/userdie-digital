# USERDIE Digital — рабочая точка на 19 ноября 2026 года

## Репозиторий и ветка
- Репозиторий: `userdie-foundation/userdie-digital`
- Основная ветка: `main`
- Базовый commit main: `a2066a7d8542efc20fe0d69dbe4f5f60a1b9640a`
- Рабочая ветка: `feature/valuation-workspace-api-integration`
- Последний commit на момент фиксации: `b96f26b4e6abcaba47b03ec7f68b7ee1cb6b6c13`
- Ветка опережает main на 19 коммитов и не отстаёт от main.
- PR #29 остаётся открытым Draft, не объединён. Состояние подтверждено GitHub: `draft=true`, `merged=false`.

## Изменения 19.11.2026
1. В `website/prototype/workspace-api.js` добавлен сценарий повторной редакции документа со статусом `changes_requested`.
2. Форма загружает последнюю сохранённую версию через GET `/api/v1/analytical-documents/:id`, позволяет отредактировать разделы аналитического материала и отправляет новую версию через POST `/api/v1/analytical-documents/:id/versions`.
3. После сохранения интерфейс обновляет реестр; серверный маршрут версий уже реализован в backend и сохраняет историю, контроль SHA-256 и событие аудита.
4. В `backend/test/analytical-documents.test.mjs` добавлены тесты: доступ автора к содержимому последней версии и запрет создания версии пользователем без полномочий оценки активов.
5. Описание PR #29 обновлено, чтобы отразить новый сценарий и тесты.

## Проверки GitHub Actions
- Для commit `c3cc6e43675c7eebdc00fbafd3fe0dfb12337e5e`: Website Quality Gate, Public repository security check и USERDIE Security Guard завершились успешно; Backend checks на момент последней проверки выполнялся.
- Для commit `b96f26b4e6abcaba47b03ec7f68b7ee1cb6b6c13`: Website Quality Gate завершился успешно; Public repository security check завершился успешно; USERDIE Security Guard выполнялся (CodeQL in progress); Backend checks поставлен в очередь / pending.
- Backend run `44486294317` также был запущен для предыдущего коммита и на последней проверке находился на шаге установки кириллических PDF-шрифтов; автоматические тесты ещё не стартовали.
- Не утверждать, что новые backend tests прошли, пока соответствующий workflow не завершится успешно.
- Отменённые Website Quality Gate и public security run на более раннем commit `3ec648b` были повторно успешно пройдены на последующих коммитах.

## Архитектурные и эксплуатационные ограничения
- API-origin остаётся пустым, включён demo mode; live API не активирован.
- Backend hosting, PostgreSQL, migrations 001–018, rate-limit secret, approved same-site API host/reverse proxy, точный ALLOWED_ORIGIN и persistent private PDF storage остаются предпосылками.
- Production deployment не подтверждён. Публичная публикация сайта этими изменениями не заявляется.
- PR #29 не сливать и Draft не снимать без отдельного подтверждения пользователя.
- DNS и MX/почтовые записи не изменять.

## Следующие действия
1. Дождаться завершения Backend checks и USERDIE Security Guard для актуального HEAD.
2. Проверить результаты новых backend-тестов и устранить возможные ошибки.
3. Проверить полный цикл: draft → submit → independent review → changes_requested → new version → resubmit → approved → issue → PDF.
4. Проверить миграции 001–018, изоляцию прав, хранение PDF и аудит в staging; инфраструктуру и бюджет не создавать без согласования.
5. После подтверждения CI обновить эту рабочую точку фактическими результатами.
