# Caba Edge Journal

Journal des trades NQ/MNQ exécutés sur les gameplans Caba Express+.
Site statique (HTML/CSS/JS) + Supabase. Accès privé : seul le compte propriétaire peut lire ou écrire (RLS, fonction `public.is_owner()`).

- Supabase : projet `caba-edge-journal` (ref `trtfsqkrpyixrnxrfpzk`, eu-west-3)
- Table : `public.trades` · Bucket captures : `shots` (privé)
- Config front : `config.js` (clé publishable, sans danger côté navigateur)

## Déploiement
Vercel → Import du repo → Framework "Other", aucune commande de build, dossier racine. C'est tout.
Dans Supabase → Authentication → URL Configuration : mettre l'URL Vercel en **Site URL** et dans **Redirect URLs**.

## Ajouter un trade (Claude, Codex, script)
Le R est calculé par la page : `(sortie − entrée) ÷ |entrée − stop|`, signé selon la direction. Ne jamais stocker le R à la main, ne jamais inventer un prix : si une donnée manque, demander à Erwann.

`id` = `YYYY-MM-DD-<Session>-<n>` (ex. `2026-09-30-London-1`).

```sql
insert into public.trades (id, date, time_guyane, session, status, instrument, contracts,
  plan_source, scenario, direction, entry_type, entry_level, entry_price,
  sl_level, sl_price, tp_level, tp_price, exit_price, exit_reason,
  mfe_pts, mae_pts, setup_score, gex_regime, cvd, plan_respected, notes, lessons)
values ('2026-09-30-London-1', '2026-09-30', '03:42', 'London', 'trade', 'MNQ', 2,
  'MenthorQ', 'S1 — rebond PS 0DTE', 'long', 'principale', 'PS 0DTE', 24850.25,
  'sous swing', 24830, 'HVL', 24910, 24905.5, 'TP',
  62, 9, 3, 'positive', 'divergence haussière', true, 'déroulé…', 'leçon…');
```

Session sans trade : `status = 'no_trade'`, remplir `date`, `session`, `lessons` (pourquoi).

| champ | valeurs |
|---|---|
| session | `Asian` · `London` · `NY` |
| status | `trade` · `no_trade` |
| direction | `long` · `short` |
| entry_type | `principale` · `secondaire` |
| plan_source | `Caba` · `MenthorQ` · `Quin` |
| exit_reason | `TP` · `SL` · `BE` · `trail` · `manuel` |
| gex_regime | `positive` · `negative` |
| setup_score | 0 à 4 |
| image_path | chemin du fichier dans le bucket `shots` |

### Accès pour Codex / scripts
- Via SQL : Supabase MCP (`execute_sql`) ou l'éditeur SQL du dashboard.
- Via API : clé **service_role** (Dashboard → Settings → API) dans une variable d'env locale. Ne jamais la commiter ni la mettre dans `config.js`.
