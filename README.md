# Caba Edge Journal

Journal des trades NQ/MNQ exécutés sur les gameplans Caba Express+, avec les gameplans de session et la recherche à côté.
Site statique (HTML/CSS/JS) + Supabase. Accès privé : seul le compte propriétaire lit ou écrit (RLS, `public.is_owner()`).

**Règles de travail pour les agents (Claude, Codex) : voir [`AGENTS.md`](AGENTS.md).**

- Supabase : projet `caba-edge-journal` (ref `trtfsqkrpyixrnxrfpzk`, eu-west-3)
- Tables : `trades`, `plans`, `research_results`, `gex_snapshots` · Bucket fichiers : `shots` (privé)
- Config front : `config.js` (clé publishable, sans danger côté navigateur)

## Le site
- **Journal** : KPI réels, courbe R cumulé, split par session, attribution (level, score, plan, entrée, régime), registre des trades avec captures, PDF et fichiers.
- **Sessions** : un gameplan par session (HTML Caba Express+ lisible dans le site, XML DeepCharts, PDF, captures) et les trades qui s'y rattachent.
- **Recherche** : résultats de replay/backtest (`research_results`) et archive GEX pré-session (`gex_snapshots`). Jamais mélangés aux KPI réels.

## Déploiement
Vercel → projet relié au repo, framework "Other", pas de build. Chaque push sur `main` redéploie.
Supabase → Authentication → URL Configuration : URL Vercel en **Site URL** et **Redirect URLs**.

## Accès pour Codex / scripts
- SQL : Supabase MCP (`execute_sql`) ou éditeur SQL du dashboard.
- API : clé **service_role** dans une variable d'env locale uniquement. Jamais dans le repo ni dans `config.js`.
