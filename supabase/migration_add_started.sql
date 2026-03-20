-- Migration: add started flag to sessions
-- Run this in the Supabase SQL editor if you already ran schema.sql

alter table sessions add column if not exists started boolean default false;
