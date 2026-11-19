# USERDIE Digital — рабочая точка на 19 ноября 2026 года

## Репозиторий и PR
- Репозиторий: `userdie-foundation/userdie-digital`
- Основная ветка `main`; base SHA: `a2066a7d8542efc20fe0d69dbe4f5f60a1b9640a`.
- Рабочая ветка: `feature/valuation-workspace-api-integration`.
- Последний commit с изменениями кода: `fb4fa33fa4cef7ca52150da14bf3a0d3edcc7a1a`.
- PR #29: https://github.com/userdie-foundation/userdie-digital/pull/29
- PR открыт, Draft, не объединён; последняя проверка: `mergeable=true`, `merged=false`.
- `main` не изменялась.

## Backend CI — предыдущая ошибка исправлена
- Ошибка теста `analytical document version creation is denied without valuation authority` была вызвана тем, что тестовый HTTP-сервер не получал `allowedOrigin`, и middleware останавливал запрос на CORS до проверки полномочий.
- В `backend/test/analytical-documents.test.mjs` тесту задан разрешённый Origin и `allowedOrigin: "https://platform.example"`.
- Исправление: commit `613c150f6440fffe26301e6a28d0b00221505523`.
- На этом commit все четыре workflow завершились success: Backend checks run #363, Website Quality Gate #403, Public repository security check #670, USERDIE Security Guard #957.

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

## Исправления UI/API и мобильного рабочего пространства
- Для reviewer-only роли исправлена загрузка: отказ 403 от списка проверяющих не блокирует отображение доступного реестра.
- Backend list API возвращает серверно вычисленные `canSubmit`, `canRevise`, `canReview`, `canIssue`, `canDownloadPdf`. UI показывает действия по этим флагам, а не только по статусу документа.
- Добавлены unit tests для действий автора и назначенного независимого проверяющего.
- В logout-сценарии интерфейс теперь завершает локальный сеанс только после подтверждения сервером. При сетевой ошибке кабинет остаётся открытым и сообщает, что выход не подтверждён.
- Исправлен жизненный цикл object URL для PDF: ссылка отзывается с задержкой, чтобы браузер успел обработать скачивание; добавлена доступная подпись ссылки.
- Изменения кода находятся в commit `fb4fa33fa4cef7ca52150da14bf3a0d3edcc7a1a`.
- UI-проверка выполнена по исходникам HTML/CSS/JS и workflow качества. В доступных инструментах этой сессии нет браузерного управления, поэтому фактический визуальный просмотр страницы и мобильного интерфейса не выполнен; не считать его пройденным.
- На commit `fb4fa33...` подтверждены success: Backend checks (run #370, run ID `44512863921`, job ID `135521269689`), Website Quality Gate (run #410), Public repository security check (run #677), USERDIE Security Guard (run #964), а также CodeQL, secret-pattern scan и Security operating notes. Backend job завершил все ключевые шаги: установка кириллических PDF-шрифтов, установка зависимостей, проверка синтаксиса, автоматические тесты, сборка production container image и smoke-test production container. Все шаги completed/success.

## Эксплуатационные границы
- API-origin остаётся пустым, demo mode — режим по умолчанию.
- Backend hosting, PostgreSQL, migrations 001–018, login rate-limit secret, approved same-site API host/reverse proxy, точный ALLOWED_ORIGIN и persistent private PDF storage остаются эксплуатационными предпосылками.
- Production deployment не подтверждён; публикация сайта этими изменениями не заявляется.
- PR #29 не объединять и Draft не снимать без отдельного подтверждения пользователя.
- DNS и MX/почтовые записи не изменять.

## Следующие действия
1. Backend checks для commit `fb4fa33...` завершились success; все automated tests, production container build и smoke-test подтверждены.
2. Браузерная визуальная проверка пока не выполнена: доступный набор инструментов не предоставляет управления браузером. Продолжить source-level audit, а визуальный контроль выполнить при появлении поддерживаемой browser/computer-use среды.
3. Описание PR #29 обновлено: указаны успешные Backend checks, website quality/security checks и ограничение по отсутствию браузерной визуальной проверки.
4. Отдельно подготовить staging-проверку production runtime и private PDF storage после согласования инфраструктуры; не создавать ресурсы и расходы самостоятельно.
5. Сохранять PR #29 открытым Draft до отдельного решения пользователя.
