export type ID = string;

export type ISODateString = string;

export type EntityStatus =
  | "active"
  | "inactive"
  | "archived";

export interface BaseEntity {
  id: ID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface User extends BaseEntity {
  name: string;
  email: string;
  roleId: ID;
  status: EntityStatus;
}

export interface Role extends BaseEntity {
  name: string;
  description?: string;
}

export interface Program extends BaseEntity {
  name: string;
  description?: string;
  status: EntityStatus;
  startDate?: ISODateString;
  endDate?: ISODateString;
}

export interface Project extends BaseEntity {
  programId: ID;
  name: string;
  description?: string;
  status: EntityStatus;
  startDate?: ISODateString;
  endDate?: ISODateString;
}

export interface Beneficiary extends BaseEntity {
  userId: ID;
  status: EntityStatus;
}

export interface Application extends BaseEntity {
  beneficiaryId: ID;
  programId: ID;
  status: EntityStatus;
  description?: string;
}