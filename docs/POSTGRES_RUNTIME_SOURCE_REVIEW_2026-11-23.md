# USERDIE Digital — PostgreSQL runtime source review

**Дата:** 23.11.2026  
**Тип проверки:** read-only анализ исходного кода и SQL-миграции  
**Статус:** source-level review завершён; проверка фактических ролей staging/production не выполнена.

## 1. Краткий вывод

В исходном коде предусмотрено разделение подключения API и мигратора:

- API создаёт пул PostgreSQL из `DATABASE_URL` в `backend/src/index.mjs`.
- CLI миграций использует отдельный `MIGRATIONS_DATABASE_URL` и требует явного `MIGRATIONS_ALLOW_APPLY=true` в `backend/src/db/migrate.mjs`.
- API entry point не импортирует и не запускает migration runner при старте.
- Флаг `PRIVACY_CONSENT_LEDGER_ENABLED` по умолчанию выключен в `backend/src/config.mjs`.

Это корректные исходные барьеры. Но репозиторий не доказывает, что в целевой БД созданы разные роли, что API подключается именно под non-owner ролью и что её эффективные права ограничены. Миграция 021 не создаёт роли и не устанавливает полную политику GRANT/REVOKE.

**Решение:** runtime-role gate остаётся **NOT VERIFIED** до получения read-only отчёта из изолированной staging БД и независимой проверки.

## 2. Подтверждённые факты в исходниках

| Область | Наблюдение | Вывод |
|---|---|---|
| API DB connection | `backend/src/index.mjs` создаёт `Pool` с `config.databaseUrl` | Runtime credential поступает через `DATABASE_URL` |
| Migration DB connection | `backend/src/db/migrate.mjs` создаёт отдельный `Client` с `MIGRATIONS_DATABASE_URL` | Предусмотрена отдельная credential boundary |
| Migration guard | CLI прекращает работу без `MIGRATIONS_ALLOW_APPLY=true` | Применение миграций требует явного флага |
| API startup | `backend/src/index.mjs` не импортирует `applyMigrations` или `db/migrate.mjs` | Автоматический DDL при старте API в проверенном entry point не обнаружен |
| Consent feature flag | `readConfig` задаёт default `false` | Новые consent grants fail-closed по умолчанию |
| Migration 021 | Создаёт таблицы, индексы, функции и триггеры, но не создаёт роли и не выдаёт полный набор привилегий | Role provisioning и grants должны быть обеспечены отдельным контролируемым процессом |
| Runtime SSL | `DATABASE_SSL` преобразуется в boolean; default — `false` | Нельзя считать TLS для соединения API с БД включённым без проверки deployment environment |
| Migration SSL | `MIGRATIONS_DATABASE_SSL` преобразуется в boolean; default — `false` | TLS миграционного соединения также должен быть подтверждён в целевой среде |

## 3. Обязательные инфраструктурные проверки

### 3.1 Разделение ролей

В staging необходимо подтвердить фактические значения:

- API runtime role — LOGIN, не SUPERUSER, не владелец схемы/таблиц/функций;
- migration/schema-owner role — отдельная LOGIN identity с DDL правами только для контролируемого применения миграций;
- DBA/inspection identity — отдельная роль для read-only проверки каталогов и эффективных привилегий;
- отсутствие у runtime роли прямого или унаследованного членства в owner/DDL/admin ролях;
- отсутствие у runtime роли возможности менять grants, отключать триггеры, менять владельцев или выполнять DDL.

Имена ролей в документации являются предлагаемыми логическими обозначениями, а не утверждением, что такие роли уже существуют.

### 3.2 Эффективные права consent ledger

Проверить не только прямые GRANT, но и права через PUBLIC, членство в ролях, владение объектами, column grants и default privileges.

Минимальная матрица для consent ledger:

| Объект | Минимум API runtime | Недопустимые права |
|---|---|---|
| `privacy_consent_documents` | SELECT | INSERT, UPDATE, DELETE, TRUNCATE, ownership |
| `privacy_consent_events` | SELECT, INSERT | UPDATE, DELETE, TRUNCATE, ownership |
| `audit_events` | INSERT только если требуется используемым API | UPDATE, DELETE, TRUNCATE, ownership |
| `public` schema | USAGE | CREATE, ownership |
| `schema_migrations` | Не требуется API runtime для применения миграций | DDL и изменение записей миграций |
| Migration routines | Не выдавать без обоснования | Неограниченный EXECUTE, опасные SECURITY DEFINER |

Эта таблица относится к consent ledger. Привилегии для остальных API-модулей должны быть проверены отдельно по фактическим SQL-запросам; нельзя выдавать широкие права только ради удобства.

### 3.3 Триггеры и функции migration 021

В целевой БД подтвердить:

- наличие и включённое состояние всех пользовательских триггеров на `privacy_consent_documents` и `privacy_consent_events`;
- отсутствие у runtime возможности менять состояние триггеров или обходить их через повышенные атрибуты;
- владельцев функций и их `SECURITY DEFINER` статус;
- безопасный `search_path` для всех функций с `SECURITY DEFINER`, если такие имеются;
- отсутствие широкого EXECUTE на чувствительные функции;
- отсутствие чрезмерных default privileges, которые будут автоматически выдавать runtime права на будущие объекты.

Триггеры migration 021 — дополнительный контроль целостности, а не замена разграничению прав. Владелец объектов, superuser или привилегированная роль остаются за пределами защиты обычного DML-триггера.

## 4. TLS и секреты

В `backend/.env.example` локальные примеры содержат:

- `DATABASE_SSL=false`;
- `MIGRATIONS_DATABASE_SSL=false`.

Это не доказывает, что production настроен небезопасно: пример предназначен для локальной конфигурации. Но в коде нет принудительного запрета запуска production с выключенным SSL.

До staging/production приёмки необходимо:

1. Проверить фактические deployment secrets/configuration без раскрытия значений секретов.
2. Для удалённой PostgreSQL подтвердить TLS с проверкой сертификата (`rejectUnauthorized: true` уже предусмотрен при включённом флаге).
3. Убедиться, что API и migration credentials разные и не совпадают.
4. Убедиться, что пароли/URL не попадают в логи, CI artifacts, frontend, issue comments и репозиторий.
5. Не помещать connection strings, пароли, приватные ключи или полные environment dumps в audit evidence.

## 5. Ограничения проверки

В ходе настоящего source review не выполнялись:

- подключение к staging или production PostgreSQL;
- чтение секретов GitHub Actions, hosting provider или secret manager;
- запуск SQL в целевой базе;
- применение миграций;
- изменение ролей, grants, владельцев или SSL-настроек;
- включение consent feature flag;
- проверка фактического сетевого маршрута API → PostgreSQL.

Поэтому нельзя утверждать, что staging/production runtime role уже безопасна, TLS включён или миграции применены.

## 6. Read-only evidence package для staging

После предоставления контролируемого доступа DBA/read-only оператор должен сформировать пакет без секретов:

1. Timestamp UTC и идентификатор окружения (без адресов/секретов подключения).
2. Версия PostgreSQL.
3. Результаты запросов из `docs/POSTGRES_RUNTIME_ROLE_ACCEPTANCE_AUDIT_2026-11-21.md`: role attributes, memberships, ownership, effective privileges, schema grants, trigger states, default privileges, routine EXECUTE.
4. Версии/контрольные суммы применённых миграций и подтверждение migration set.
5. Подтверждение TLS параметров соединения на стороне среды и БД.
6. Подтверждение отдельности API и migration identities без раскрытия credentials.
7. Подпись оператора, независимого проверяющего и владельца релизного решения.

Секреты, полные connection strings, токены и персональные данные не включать.

## 7. Критерии прохождения gate

Gate может быть отмечен PASS только когда одновременно:

- runtime role существует и не обладает superuser/owner/DDL/admin capabilities;
- прямые и наследуемые права соответствуют утверждённой матрице;
- триггеры migration 021 присутствуют и включены;
- нет непроверенных привилегированных SECURITY DEFINER путей;
- default privileges не создают скрытых будущих grants;
- API и migration credentials разделены;
- TLS и проверка сертификата подтверждены для удалённого подключения;
- миграционный набор и checksum ledger согласованы;
- read-only evidence независимо проверен и подписан.

До выполнения всех критериев статус остаётся **NOT VERIFIED**.

## 8. Безопасность изменений

Этот документ является только фиксацией source review. Он не меняет backend, SQL migrations, роли БД, deployment secrets, SSL flags, consent feature flag, публичные формы или production. Не применять массовые REVOKE/GRANT на основании этого документа: сначала получить полный снимок эффективных прав и подготовить отдельный проверенный план изменений для изолированного staging.
