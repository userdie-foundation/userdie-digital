# USERDIE Digital Data Model

Version: 1.0

Status:
Architecture Foundation

---

# 1. Purpose

Этот документ определяет базовую модель данных платформы USERDIE Digital.

Модель является архитектурной основой для последующего проектирования базы данных и программных модулей.

---

# 2. Core Entities

Основные сущности платформы:

- User
- Role
- Beneficiary
- Program
- Project
- Application
- Document
- Report
- Organization
- Audit Log

---

# 3. User

Пользователь системы.

Основные атрибуты:

- id
- name
- email
- status
- role_id
- created_at
- updated_at

---

# 4. Role

Роль пользователя.

Основные роли:

- Administrator
- Employee
- Partner
- Volunteer
- Beneficiary

Основные атрибуты:

- id
- name
- description

---

# 5. Beneficiary

Получатель помощи или участник социальной программы.

Основные атрибуты:

- id
- user_id
- status
- created_at
- updated_at

Доступ к данным Beneficiary должен контролироваться политиками безопасности и правами доступа.

---

# 6. Program

Социальная программа фонда.

Основные атрибуты:

- id
- name
- description
- status
- start_date
- end_date
- created_at
- updated_at

---

# 7. Project

Отдельный проект внутри программы.

Основные атрибуты:

- id
- program_id
- name
- description
- status
- start_date
- end_date
- created_at
- updated_at

---

# 8. Application

Обращение или заявка участника.

Основные атрибуты:

- id
- beneficiary_id
- program_id
- status
- description
- created_at
- updated_at

---

# 9. Document

Документ, связанный с пользователем, заявкой, программой или проектом.

Основные атрибуты:

- id
- entity_type
- entity_id
- document_type
- storage_reference
- created_at
- updated_at

---

# 10. Report

Отчёт по программе или проекту.

Основные атрибуты:

- id
- program_id
- project_id
- report_type
- period
- status
- created_at
- updated_at

---

# 11. Organization

Организация, участвующая во взаимодействии с фондом.

Основные атрибуты:

- id
- name
- type
- status
- created_at
- updated_at

---

# 12. Audit Log

Журнал критических действий системы.

Основные атрибуты:

- id
- user_id
- action
- entity_type
- entity_id
- timestamp
- result

---

# 13. Relationships

Основные связи:

User → Role

Program → Project

Beneficiary → Application

Program → Application

Application → Document

Program → Report

Project → Report

User → Audit Log

Organization → Project

---

# 14. Data Integrity

Система должна обеспечивать:

- уникальность идентификаторов;
- ссылочную целостность;
- обязательность критических полей;
- контроль статусов;
- корректность связей между сущностями.

---

# 15. Privacy

Персональные и иные защищённые данные не должны публиковаться в открытых интерфейсах.

Доступ должен предоставляться только пользователям с соответствующими правами.

---

# 16. Future Database

На следующем этапе архитектуры будет определён конкретный тип базы данных и физическая схема хранения.

Текущий документ определяет логическую модель, а не окончательную структуру SQL/NoSQL базы.

---

# 17. Status

Project:

USERDIE Digital

Release:

0.3.0

Phase:

Data Architecture Foundation