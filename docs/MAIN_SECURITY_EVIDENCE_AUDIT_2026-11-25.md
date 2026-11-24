# USERDIE Digital — контрольная проверка безопасности main и доказательств CI

**Дата проверки:** 25.11.2026  
**Репозиторий:** `userdie-foundation/userdie-digital`  
**Проверенная ветка:** `main`  
**Проверенный HEAD:** `b6b19cbe7897f8807a07a77f2828013aa7fae03b`  
**Тип проверки:** read-only аудит GitHub metadata, Actions и исходников; без доступа к staging/production.

## 1. Резюме

Проверка выявила один подтверждённый критический организационно-технический блокер: **ветка `main` не защищена правилами GitHub**.

Подтверждения:
- GitHub branch metadata для `main` возвращает `protected: false`.
- В объекте branch protection указано `enabled: false`, enforcement status checks — `off`.
- API repository rulesets вернул пустой список `[]`.
- Issue #51 с требованиями защиты `main` остаётся открытым.

Следствие: наличие CI workflows не означает, что GitHub запрещает прямые push, требует независимое approval или блокирует merge при проваленных checks. До фактической настройки защиты нельзя считать release gate по защите основной ветки пройденным.

## 2. Контрольная точка и CI

HEAD `main`: `b6b19cbe7897f8807a07a77f2828013aa7fae03b`  
Commit: `Integrate accessible workspace dashboard and calendar`  
Дата коммита: 24.11.2026 13:29:09 UTC.

Для указанного SHA GitHub Actions API вернул 9 запусков. Все 9 завершились со статусом `completed / success`:

| Workflow | Event | Result |
|---|---|---|
| USERDIE Digital robot team | push | success |
| USERDIE security guard | push | success |
| Website quality gate | push | success |
| Public repository security check | push | success |
| Deploy public website | push | success |
| Daily platform health check | schedule / workflow_run | success |
| USERDIE Digital robot team | schedule | success |

Ссылки на основные запуски:
- Backend-independent website deploy: https://github.com/userdie-foundation/userdie-digital/actions/runs/45403912641
- Website quality gate: https://github.com/userdie-foundation/userdie-digital/actions/runs/45403912770
- Public repository security: https://github.com/userdie-foundation/userdie-digital/actions/runs/45403912778
- USERDIE security guard (CodeQL + tracked-file scan): https://github.com/userdie-foundation/userdie-digital/actions/runs/45403912685
- Robot Team: https://github.com/userdie-foundation/userdie-digital/actions/runs/45403912744
- Daily platform health: https://github.com/userdie-foundation/userdie-digital/actions/runs/45407167069

**Ограничение:** Backend checks отсутствует среди запусков, связанных с этим SHA. Это согласуется с триггером workflow: push запускает backend checks только при изменении `backend/**` или самого workflow. Следовательно, backend/PostgreSQL интеграционные тесты нельзя приписывать коммиту от 24.11.2026.

Для PR #29 отдельно подтверждены результаты, указанные в описании PR на синхронизированном head `b65106d741ddd2a9ca98786086b47a4bac866ac4`: 206 tests passed, PostgreSQL 16 integration suite, production-container smoke test, website quality, CodeQL и secret scan. Эти результаты относятся к PR head, а не автоматически к merge-коммиту или последнему HEAD `main`.

## 3. Состояние PR #29

GitHub подтверждает:
- PR #29 закрыт и объединён.
- Merge commit: `c0c6398e580cd7929cb1866f7b4141c85c2bbc2e`.
- Объединение выполнено 21.11.2026.
- Объём: 71 файл, 5 046 добавлений, 31 удаление.

Объединение кода не является подтверждением юридического утверждения форм, развертывания backend или допуска к реальной обработке персональных данных.

## 4. Backend / PostgreSQL — исходные барьеры и незакрытые доказательства

Проверенные исходники подтверждают:
- API получает соединение через `DATABASE_URL`.
- Migration CLI использует отдельный `MIGRATIONS_DATABASE_URL`.
- Применение миграций требует явного `MIGRATIONS_ALLOW_APPLY=true`.
- API entry point не запускает migration runner автоматически.
- `PRIVACY_CONSENT_LEDGER_ENABLED` по умолчанию равен `false`.
- Migration 021 создаёт таблицы, функции и триггеры consent ledger, но не создаёт отдельные runtime/migration роли и не задаёт полную матрицу GRANT/REVOKE.
- `DATABASE_SSL` и `MIGRATIONS_DATABASE_SSL` имеют локальный default `false`; production-конфигурация должна быть проверена отдельно.

Статус:
- Разделение credentials — предусмотрено в коде, фактическое разделение секретов не доказано.
- Runtime DB role least privilege — NOT VERIFIED.
- TLS и проверка сертификата в целевой среде — NOT VERIFIED.
- Фактическое применение миграций в staging — NOT VERIFIED.
- Состояние триггеров, владельцев, effective grants и default privileges в staging — NOT VERIFIED.
- Consent ledger feature flag — остаётся выключенным по умолчанию; фактическое значение deployment environment не прочитано.

Для сбора доказательств уже существует документ:
`docs/POSTGRES_STAGING_READONLY_EVIDENCE_QUERIES_2026-11-23.md`.
Он содержит read-only SQL для изолированного staging и не был выполнен в рамках этой проверки.

## 5. Защита main — обязательные действия

Issue #51 остаётся открытым. Требуемая конфигурация:
1. Require pull request before merging; запретить обычные прямые push.
2. Минимум одно независимое approval.
3. Dismiss stale approvals after new commits.
4. Require all applicable checks: Backend checks, CodeQL/security guard, public security scan, website quality gate (по области изменений).
5. Require branches to be up to date.
6. Require conversation resolution.
7. Restrict force pushes and branch deletion.
8. Документированный emergency bypass с audit trail.

**Критерий закрытия:** повторно прочитать активную branch protection/ruleset конфигурацию GitHub и подтвердить её фактическое действие. Текст issue и наличие workflow не считаются доказательством включения защиты.

## 6. Следующие этапы

### Gate A — GitHub governance
- Настроить защиту `main` через GitHub Settings / Rulesets с полномочиями администратора.
- Повторно прочитать конфигурацию через GitHub API.
- Проверить требуемые approvals/checks и отсутствие обычного bypass.

### Gate B — staging PostgreSQL
- Получить контролируемый доступ к изолированному staging.
- Выполнить read-only пакет запросов из указанного документа под runtime identity и отдельной DBA/read-only identity.
- Зафиксировать обезличенный evidence package и независимую проверку.
- Не выполнять массовые GRANT/REVOKE до анализа полной матрицы эффективных прав.

### Gate C — privacy release gates
- Сохранить consent feature flag выключенным.
- Не регистрировать/активировать документы до юридического утверждения.
- Не подключать специальные категории, распространение и представительский capture к обычному endpoint.
- Не использовать реальные данные благополучателей в тестах и демонстрационных наборах.

### Gate D — backend CI
- Для следующего PR с backend-изменениями требовать актуальные Backend checks и PostgreSQL integration suite.
- Проверить workflow run на конкретном PR head SHA, не переносить результаты между разными SHA.

## 7. Границы выполненной работы

В рамках этой контрольной проверки:
- GitHub metadata, branch protection status, rulesets, PR #29, Actions runs и исходные файлы были прочитаны.
- Подтверждено, что `main` не защищена.
- Подтверждены успешные 9 workflow runs для HEAD `b6b19cbe...`.
- Подготовлен данный отчёт в отдельной audit-ветке.

Не выполнялись:
- изменение branch protection/rulesets;
- изменения `main`, backend-кода или SQL migrations;
- доступ к staging/production, выполнение SQL или применение миграций;
- чтение/изменение secrets;
- изменение DNS, MX, домена или production deployment;
- включение consent feature flag.

**Итоговый статус:** CI для последнего website/dashboard commit — PASS; GitHub branch protection — FAIL / NOT ENABLED; PostgreSQL runtime-role gate — NOT VERIFIED; privacy consent release gate — CLOSED / DO NOT ENABLE.
