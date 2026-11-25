# USERDIE Digital — контрольная проверка безопасности main и доказательств CI

**Дата проверки:** 25.11.2026  
**Репозиторий:** `userdie-foundation/userdie-digital`  
**Проверенная ветка:** `main`  
**Проверенный HEAD:** `b6b19cbe7897f8807a07a77f2828013aa7fae03b`  
**Тип проверки:** read-only аудит GitHub metadata, Actions, rulesets и исходников; без доступа к staging/production.

## 1. Резюме

Первоначальный вывод о полном отсутствии защиты `main` оказался устаревшим и исправлен по повторному чтению GitHub API.

Подтверждено:
- классическая branch protection для `main` не включена: branch metadata сообщает `protected: false`;
- одновременно существует активный repository ruleset **Protect main — USERDIE Digital**, ID `28029243`, enforcement `active`;
- ruleset требует Pull Request, минимум одно одобрение, отклонение устаревших approvals после новых коммитов и разрешение review conversations;
- включены обязательные status checks со строгой политикой актуальности ветки, запрет удаления и non-fast-forward обновлений;
- для CodeQL заданы пороги security alerts `high_or_higher` и alerts `errors`;
- список bypass actors пуст; GitHub сообщает для подключённой учётной записи `current_user_can_bypass: never`.

**Ограничение:** активный ruleset подтверждает конфигурацию GitHub, но не заменяет отдельные практические проверки блокировки прямого push/force-push обычным участником и сценария восстановления администратором. Не следует называть поле `protected: false` доказательством отсутствия всех правил, поскольку активный ruleset действует независимо от классической branch protection.

## 2. Состав обязательных проверок

Ruleset ID `28029243` содержит следующие обязательные contexts:
- `CodeQL JavaScript and TypeScript analysis`;
- `Check links, anchors, HTML accessibility and inline JavaScript`;
- `Scan tracked files for likely exposed secrets`;
- `scan`.

**Обнаруженный пробел:** context `Backend checks` в обязательный список ruleset не включён. Workflow Backend checks запускается по изменениям `backend/**` или собственного workflow-файла, поэтому нужно настроить обязательность Backend checks именно для PR с backend-изменениями (например, через отдельную always-reporting gate/check либо подходящую конфигурацию required workflows). Нельзя просто объявить Backend checks обязательным context, если для остальных PR он не публикуется: это может заблокировать слияние изменений, не затрагивающих Backend.

Issue #51 остаётся открытым: конфигурация ruleset создана, но полный набор acceptance checks issue ещё не доказан. В частности, нужно проверить поведение блокировки обычных прямых/force push и документировать безопасный recovery path.

## 3. Контрольная точка и CI

HEAD `main`: `b6b19cbe7897f8807a07a77f2828013aa7fae03b`  
Commit: `Integrate accessible workspace dashboard and calendar`  
Дата коммита: 24.11.2026 13:29:09 UTC.

Для указанного SHA GitHub Actions API вернул 9 запусков; все завершились `completed / success`:
- USERDIE Digital robot team;
- Daily platform health check (два запуска);
- Public repository security check;
- Website quality gate;
- USERDIE security guard;
- Deploy public website.

Основные запуски:
- Deploy public website: https://github.com/userdie-foundation/userdie-digital/actions/runs/45403912641
- Website quality gate: https://github.com/userdie-foundation/userdie-digital/actions/runs/45403912770
- Public repository security: https://github.com/userdie-foundation/userdie-digital/actions/runs/45403912778
- USERDIE security guard: https://github.com/userdie-foundation/userdie-digital/actions/runs/45403912685
- Robot Team: https://github.com/userdie-foundation/userdie-digital/actions/runs/45403912744
- Daily platform health: https://github.com/userdie-foundation/userdie-digital/actions/runs/45407167069

**Ограничение:** Backend checks отсутствует среди запусков, связанных с этим SHA. Workflow запускает push-проверку только при изменении `backend/**` или самого workflow. Поэтому backend/PostgreSQL integration tests нельзя приписывать commit от 24.11.2026.

Для PR #56 на его конкретном head SHA `55773e0a5b561c7852b601c5a41153c14802a3f6` подтверждены успешные Website quality gate, Backend checks, USERDIE security guard и Public repository security check. Для PR #58 на head SHA `a3691c65e0836c0e053ababaf4cca6a95c6f5ced` подтверждены Website quality gate, Public repository security check и USERDIE security guard. Эти результаты относятся к соответствующим PR head SHA, а не к текущему `main`.

## 4. Backend / PostgreSQL — незакрытые доказательства

Проверенные исходники и staging runbook подтверждают:
- API использует `DATABASE_URL`;
- migration CLI использует отдельный `MIGRATIONS_DATABASE_URL`;
- применение миграций требует явного `MIGRATIONS_ALLOW_APPLY=true`;
- API startup не запускает миграции автоматически;
- migration 021 создаёт consent-ledger tables, functions и triggers, но не создаёт runtime/migration roles и не задаёт полную матрицу GRANT/REVOKE;
- Backend CI использует временный PostgreSQL 16 service для интеграционных тестов; это не hosted staging.

Не подтверждено:
- существование и адрес изолированной hosted staging-среды;
- фактическое применение миграций 001–021 в staging;
- effective privileges runtime-role, владельцы объектов, memberships и default ACL на целевой БД;
- TLS-параметры и проверка сертификата на реальном соединении;
- backup/restore и operational ownership.

В PR #33 подготовлен read-only audit CLI для ограниченной проверки consent-ledger privileges и triggers. Это полезный инструмент, но он не проверяет всё приложение, не подтверждает тела trigger functions и не заменяет полный permission review/RLS/security assessment. PR #33 необходимо синхронизировать с текущим `main` и повторно проверить до объединения. Успешные CI runs на его head SHA не доказывают фактическое состояние staging.

Документ с SQL-проверками: `docs/POSTGRES_STAGING_READONLY_EVIDENCE_QUERIES_2026-11-23.md`. Его фактическое выполнение в staging не подтверждено.

## 5. Privacy и юридические release gates

Сохраняются запреты:
- не включать `PRIVACY_CONSENT_LEDGER_ENABLED` в production;
- не регистрировать реальные версии согласий в production;
- не подключать публичные формы заявителя к consent API;
- не принимать реальные данные благополучателей через демонстрационные формы;
- не расширять self-only capture migration 021 на специальные категории, распространение или представительские сценарии без отдельной юридической модели и приёмки.

Юридический план release gates от 23.11.2026 оставляет LGL-01–LGL-06 открытыми. Merge, CI и проектная документация не являются юридическим утверждением форм или разрешением на обработку персональных данных.

## 6. Следующие действия

### Gate A — GitHub governance
- Сохранить активный ruleset ID `28029243`.
- Закрыть acceptance checks issue #51: проверить блокировку обычных прямых push/force-push и документировать recovery.
- Добавить условно обязательную Backend gate для PR с изменениями `backend/**`; проверить, что website-only PR не блокируется отсутствующим backend context.
- Повторно прочитать ruleset и проверку на тестовом PR после настройки.

### Gate B — PR #33 и runtime-role audit
- Синхронизировать PR #33 с текущим `main`; на момент проверки compare показывает расхождение: 18 commits ahead и 14 behind.
- Повторно запустить Backend checks и PostgreSQL integration suite на актуальном head.
- Проверить сценарии отсутствующей роли, memberships, PUBLIC/default ACL, владения объектов, отсутствующих/disabled triggers и несовпадения trigger/function/table.
- Только после этого принимать решение о merge; не запускать CLI против production.

### Gate C — isolated staging PostgreSQL
- Отдельно подтвердить хост, регион, TLS, secret manager и владельцев окружения.
- Развернуть новую изолированную staging БД и отдельные migration-owner, runtime и read-only audit identities.
- Применить миграции только после review и backup/restore rehearsal.
- Выполнить read-only evidence queries под runtime identity и DBA/read-only identity; сохранить обезличенный протокол и независимое подтверждение.
- Не выполнять массовые GRANT/REVOKE без полной матрицы эффективных прав.

### Gate D — workspace server integration
- Провести review PR #56 и тесты для положительных и отрицательных ролей/скоупов.
- Проверить, что assignee identity не попадает в публичный task DTO.
- Проверить серверную авторизацию статуса, конкурентное переназначение и запрет переходов.
- Не задавать API origin и не включать live connection до приёмки staging, TLS, auth и privacy.

### Gate E — privacy release gates
- Сохранить consent feature flag выключенным.
- Закрыть LGL-01–LGL-06 утверждёнными документами и тестируемыми процедурами.
- Не включать специальные категории, распространение и representative capture в обычный endpoint.
- Не использовать реальные данные в CI и демонстрационных наборах.

## 7. Границы выполненной проверки

Выполнено read-only чтение GitHub metadata, repository ruleset, PR #29/#33/#56/#57/#58, Actions runs и исходных файлов. Подтверждены активный ruleset, его обязательные contexts и отсутствие Backend checks в списке required contexts.

Не выполнялись:
- изменение ruleset/branch protection;
- изменения `main`, backend-кода или SQL migrations;
- доступ к staging/production, выполнение SQL или применение миграций;
- чтение/изменение secrets;
- изменение DNS, MX, домена или production deployment;
- включение consent feature flag.

**Итог:** GitHub governance — CONFIGURED / PARTIAL ACCEPTANCE; required Backend gate — GAP; current-main website/security CI — PASS; PR #33 — REBASE/UPDATE AND REVALIDATE; PR #56 — CI PASS / REVIEW REQUIRED; hosted PostgreSQL staging — NOT VERIFIED; privacy consent release gate — CLOSED / DO NOT ENABLE.
