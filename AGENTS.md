# AGENTS.md — règles communes (Claude, Codex, tout agent)

Ce repo est le **Caba Edge Journal** d'Erwann : journal de trades réels NQ/MNQ + recherche.
Site statique (index.html / style.css / app.js / config.js), déployé sur Vercel à chaque push sur `main`.
Données : Supabase projet `caba-edge-journal` (ref `trtfsqkrpyixrnxrfpzk`).

## Règles non négociables
1. **Jamais de chiffre inventé.** Pas de prix, win rate, espérance ou n qui ne vient pas d'une source réelle (capture, XML, Quin, replay exécuté). Si une donnée manque, laisser le champ vide et le demander à Erwann.
2. **Réel ≠ recherche.** Les trades réels vont dans `trades`. Les trades de replay/paper vont dans `bt_trades` (rattachés à une `bt_sessions`). Les résultats agrégés de recherche vont dans `research_results`. Jamais l'un dans l'autre, jamais de backtest ni de recherche dans les KPI du journal.
3. **Pas de données dans le code.** Aucun chiffre de trade ou de recherche écrit en dur dans `app.js` / `index.html`. Tout passe par Supabase ; le site lit les tables.
4. **Le R n'est jamais stocké.** Il est calculé par le site : `(sortie − entrée) ÷ |entrée − stop|`, signé par direction.
5. **Sample size toujours visible.** n < 30 = `low_n`. Ne jamais présenter un résultat low_n comme un edge.
6. **Secrets.** Seule la clé *publishable* est dans `config.js`. La clé `service_role` ne va jamais dans le repo.
7. **Accès.** Toutes les tables et le bucket sont en RLS `public.is_owner()` (uid du compte d'Erwann). Ne jamais ouvrir une policy à `anon` ni à tous les `authenticated`.
8. **Avant de pousser :** `git pull --rebase` (deux agents travaillent sur ce repo), `node --check app.js`, et garder le site utilisable sur téléphone (390 px, pas de scroll horizontal).

## Tables
| table | rôle | clé |
|---|---|---|
| `trades` | trades réels et sessions no-trade | `id` = `YYYY-MM-DD-<Session>-<n>` |
| `plans` | un gameplan par session (+ fichiers) | `id` = `YYYY-MM-DD-<Session>` ; `trades.plan_id` y pointe |
| `research_results` | résultats de replay / backtest | identity ; `status` ∈ low_n, exploratoire, solide, rejeté |
| `gex_snapshots` | GEX relevé **avant** la session, horodaté | identity ; `captured_at` doit précéder la session |
| `bt_sessions` | session de backtest : `kind` ∈ replay·paper, date rejouée, session, setup, règles (`method`), `plan_id` optionnel | identity |
| `bt_trades` | trades d'une session de backtest (mêmes champs prix/levels/MFE/MAE que `trades`, `rules_respected`) | identity ; `bt_session_id` → `bt_sessions` (cascade) |

Colonnes `trades` : date, time_guyane, session (Asian·London·NY), status (trade·no_trade), instrument, contracts, plan_source (Caba·MenthorQ·Quin), scenario, direction (long·short), entry_type (principale·secondaire), entry_level, entry_price, sl_level, sl_price (stop INITIAL, base du R), sl_moved_price (si le stop a été déplacé), tp_level, tp_price, exit_price, exit_reason (TP·SL·BE·SL déplacé·trail·manuel), mfe_pts, mae_pts, setup_score (0-4), gex_regime (positive·negative), cvd, plan_respected, error_tags, notes, lessons, attachments, plan_id.

`error_tags` (text[]) : erreurs d'exécution **déclarées par Erwann**, jamais déduites par un agent. Valeurs : chase, early, late, stop_moved, early_exit, revenge, off_window, size.
**MFE / MAE (pts)** : à renseigner sur chaque trade (réel et backtest). Le simulateur BE et le labo MFE/MAE du site n'utilisent que les trades où ils sont renseignés.

`attachments` (trades et plans) = tableau JSON `[{ "path", "name", "type", "size" }]`, fichiers dans le bucket privé `shots`
(`trades/<id>/…` ou `plans/<id>/…`). Les fichiers s'ajoutent depuis le site (un agent sans accès Storage ne peut pas uploader).

## Ajouter des résultats de recherche (Codex)
```sql
insert into public.research_results (setup, session, source, period_start, period_end, n, win_rate, expectancy_r, status, method, notes)
values ('Cassure + retest', 'NY', 'replay DeepCharts + XML MenthorQ', '2026-08-18', '2026-09-28', 22, 0.55, 0.31, 'low_n',
        'Entrée ≤ 10 pts du level après clôture 1 min + retest ; T1 ≥ 0,8R ; time exit 45 min ; 1 tick slippage', null);
```
`win_rate` entre 0 et 1. Mettre à jour la ligne existante plutôt que d'en empiler une nouvelle pour le même setup et la même période.

## Ajouter un trade de backtest
```sql
insert into public.bt_sessions (kind, date, session, setup, source, gex_regime, method) values ('replay', '2026-09-22', 'London', 'Fade cluster GEX', 'MenthorQ', 'positive', 'BE +1.5R, TP 2R') returning id;
insert into public.bt_trades (bt_session_id, time_guyane, direction, entry_price, sl_price, tp_price, exit_price, exit_reason, mfe_pts, mae_pts) values (<id>, '03:20', 'short', 30000, 30020, 29960, 29960, 'TP', 45, 6);
```

## Stats affichées par le site (calculées, jamais stockées)
- IC 95 % du win rate : Wilson. IC 95 % de l'espérance : bootstrap 2000 tirages, graine fixe.
- Simulateur BE : uniquement sur les trades avec MFE. Ordre MFE/MAE inconnu → résultat en fourchette (ambigus / inconnus), jamais un chiffre unique inventé.

## Ajouter un trade (Claude, à partir d'une capture + gameplan)
Insert dans `trades` avec `plan_id` renseigné si la session existe. Toute donnée non lisible sur la capture = demander, ne pas deviner.
