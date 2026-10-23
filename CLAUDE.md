@AGENTS.md

# Instruções permanentes — Funilly (wacrm)

## REGRA MAIS IMPORTANTE: commit + push obrigatório
Ao final de TODA tarefa, sem exceção:
git add -A && git commit -m "descrição" && git push origin main

## Git config
git config user.name "Nathan Garcia"
git config user.email "nathan.gaarcia01@gmail.com"

## Regra de agentes auxiliares (subagents)
Agentes auxiliares (subagents) NUNCA fazem commit, push, migration ou escrita no banco. Só leem e reportam. Commit/push só pelo agente principal, depois de revisar.

## Contexto
- Produto: Funilly (antigo wacrm)
- Stack: Next.js 16 + Supabase + Stripe + WhatsApp Cloud API
- Banco: prrpzgozbwsfihbxizbu
- Deploy: https://wacrm-uhnw.onrender.com
- UI: português PT-BR obrigatório
- Conta is_internal=true bypassa billing
