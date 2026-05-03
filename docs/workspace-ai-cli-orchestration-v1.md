# Workspace AI et orchestration d'agents CLI — v1

## 1. Statut du document

Ce document est canonique pour la direction produit **JON Workspace AI**.

Il ne remplace pas les documents sur le runtime, les approvals, le browser control, le computer control, le capability graph ou les skills. Il les relie dans une vision produit plus large : JON doit devenir une surface de travail missionnelle où la conversation, les runs, les terminaux, le navigateur, les artefacts, les preuves et les coûts restent cohérents.

## 2. Vision Workspace AI

Dans ce projet, un `workspace AI` signifie :

- une application desktop orientée mission,
- une conversation principale épurée comme point d'entrée,
- des surfaces de travail vivantes autour de cette conversation,
- un moteur agentique gouverné qui peut planifier, exécuter, vérifier et restituer,
- une capacité à superviser des outils locaux, y compris des terminaux explicitement attachés,
- une auditabilité forte : preuves, coûts, décisions, handoffs et résultats.

JON ne doit pas devenir seulement :

- un chat avec quelques actions,
- une console admin,
- un agent desktop/browser isolé,
- un terminal augmenté,
- un orchestrateur multi-agent opaque.

La promesse produit reste : l'utilisateur délègue une mission, JON travaille dans un cadre autorisé, puis restitue un résultat vérifiable.

## 3. Surfaces du workspace

La surface principale reste la conversation missionnelle. Elle doit être simple, dynamique, lisible et orientée utilisateur.

Les surfaces secondaires enrichissent le travail sans dominer l'expérience :

- `Terminal surfaces` : sessions terminal explicitement attachées et autorisées.
- `Browser surface` : état navigateur, page courante, preuves, blocages, stratégie de navigation.
- `Artefacts` : fichiers, rapports, captures, sorties exploitables.
- `Evidence` : captures, manifests, logs et preuves liées à un run.
- `Cost and token posture` : coût estimé, stages coûteux, réutilisations, suppressions.
- `Run inspector` : fil conducteur du run, décisions, approvals, erreurs, prochaines étapes.

## 4. JON comme orchestrateur d'agents CLI

JON peut superviser des agents CLI spécialisés comme Codex CLI ou Claude Code CLI uniquement quand leur terminal est explicitement attaché et autorisé.

Le rôle de JON n'est pas de prendre un contrôle shell arbitraire invisible. Son rôle est de :

- observer l'état d'un terminal autorisé,
- identifier le type d'agent CLI si possible,
- détecter s'il tourne, attend une entrée, a terminé, est en erreur ou nécessite attention,
- relier cet état au cahier des charges global,
- proposer une action de supervision,
- injecter du contexte seulement si la policy et le mode d'autonomie l'autorisent,
- journaliser chaque décision.

### États terminal canoniques

- `attached` : terminal connu du workspace, pas encore qualifié comme actif.
- `running` : une commande ou un agent semble actif.
- `waiting_for_input` : le terminal attend une entrée utilisateur ou une confirmation.
- `completed` : la tâche observée semble terminée.
- `error` : une erreur explicite est visible.
- `needs_attention` : état non fatal mais action humaine ou agentique probablement nécessaire.
- `detached` : terminal retiré du workspace.

### Types d'agents CLI

- `codex_cli`
- `claude_code_cli`
- `generic_cli`
- `unknown`

## 5. Politique de réponse aux agents CLI

JON doit distinguer :

- `observe_only` : ne rien injecter, seulement suivre.
- `suggest_user_reply` : proposer une réponse à l'utilisateur.
- `request_human_approval` : demander une validation avant action.
- `auto_inject_context` : injecter un contexte autorisé dans un terminal attaché, uniquement si le mode et la policy le permettent.
- `escalate_human` : remonter à l'humain parce que la décision est ambiguë, risquée ou hors policy.
- `stop_terminal` : proposer l'arrêt, jamais comme action furtive.

Le comportement par défaut est assisté : JON observe, explique, propose et demande confirmation sur les actions sensibles.

## 6. Suivi du cahier des charges global

JON doit conserver une vue plus haute que chaque terminal individuel :

- objectif global,
- sous-tâches,
- progression estimée,
- blocages,
- décisions déjà prises,
- terminaux impliqués,
- prochaines étapes recommandées.

Ce suivi est un objet produit, pas un simple log. Il doit pouvoir alimenter :

- la conversation principale,
- le panneau d'inspection,
- les traces opérateur,
- les handoffs humains.

## 7. UX cowork moderne

La conversation reste la surface primaire :

- bulles lisibles,
- formulation naturelle,
- updates courts,
- approvals intégrées,
- résultats et preuves visibles sans bruit technique.

Les détails lourds doivent rester secondaires :

- terminal trace,
- run trace,
- coût,
- policy outcome,
- raw logs,
- détails d'orchestration.

Le workspace doit donner l'impression que JON travaille avec l'utilisateur, pas que l'utilisateur opère une console.

## 8. Stratégie navigateur

JON doit supporter deux modes complémentaires :

- `workspace_browser_mode` : navigateur contrôlé et traçable, préféré pour les missions web avec preuve et état navigateur robuste.
- `system_browser_mode` : navigateur local visible par l'utilisateur, utile pour des actions desktop réelles où l'utilisateur veut voir son environnement habituel.

La direction cible est hybride :

- DOM/CDP-first quand un navigateur contrôlé est disponible,
- fallback visuel/accessibilité quand nécessaire,
- browser système seulement avec approvals et preuve explicite,
- pas de stealth, pas de bypass anti-bot, pas de contournement de protections.

## 9. Modes d'autonomie terminale

Les modes sont réglables, mais le plancher de sécurité reste non négociable.

- `assisted` : défaut. JON observe, alerte, propose, demande approval.
- `supervised_autonomy` : JON peut préparer ou injecter du contexte non sensible dans des terminaux autorisés si la policy l'autorise.
- `manual_only` : JON ne fait que restituer l'état et attend une action humaine.

Les actions interdites restent interdites : credentials, exfiltration, paiement/achat, bypass sécurité, élévation furtive, actions destructrices non approuvées.

## 10. Observabilité attendue

Chaque décision d'orchestration terminal doit enregistrer :

- terminal concerné,
- état observé,
- agent détecté,
- action recommandée,
- raison courte,
- niveau d'approbation requis,
- lien éventuel avec mission, conversation ou run,
- timestamp.

## 11. Implémenté maintenant

### 11.1 Workspace backend

- Modèle persistant de sessions terminal attachées (`workspace_terminal_sessions` SQLite).
- Détection heuristique d'état terminal avec priorité correcte `exitCode → text patterns` (bug exitCode=0 corrigé).
- Classification Codex CLI / Claude Code CLI / generic CLI / unknown.
- Journal de décisions d'orchestration (`workspace_terminal_decisions`) avec `evaluateTerminalIntervention`.
- Mission brief workspace persistant (`workspace_mission_briefs`) avec objectif, progression, blockers, next steps.
- API workspace complète : `GET /workspace`, `POST /mission-brief`, `POST /terminals`, `POST /terminal-processes`, `PATCH /terminals/:id`, `POST /terminals/:id/input`, `POST /terminals/:id/stop`.
- **Bridge terminal → conversation** : quand un terminal passe à `waiting_for_input`, `needs_attention` ou `error`, JON injecte automatiquement un tour de conversation `kind: "terminal_alert"` dans la conversation active.
- SSE event `workspace.terminal.conversation_alert` diffusé à tous les abonnés.
- Superviseur de processus CLI gouverné par allowlist (`CliTerminalSupervisor`).
- Catalogue local des CLI réellement détectés sur la machine (`codex`, `claude` si présents) pour éviter de proposer des lancements cassés côté UI.
- Lancement sans shell (sécurisé), capture persistée `stdout` / `stderr` / `stdin` / exit.
- Écriture contrôlée dans `stdin` avec approval explicite ou autonomie supervisée.
- Blocage des entrées contenant secrets ou credentials.
- Modes d'autonomie : `assisted`, `supervised_autonomy`, `manual_only`.

### 11.2 Frontend workspace

- Conversation principale SSE streaming avec `TerminalAlertMessage` en ligne dans le thread.
- Bulle terminal dédiée dans le fil principal pour exposer les surfaces terminales workspace, les agents CLI détectés et une création rapide de terminal sans passer par la trace.
- Carte terminal alert avec : badge statut, label terminal, sortie récente, action de décision JON.
- Champ de réponse direct depuis la conversation vers le terminal (assisté uniquement avec `approved: true`).
- Une seule colonne workspace à droite : rail réduit par défaut, puis ouverture soit de `Terminal`, soit de `Trace`, dans la même colonne.
- Vue terminal à deux niveaux :
  - `cards` : vue actuelle compacte par cartes terminal.
  - `surface` : vraie surface terminal plus riche avec sélecteur de session, transcript live regroupé, métadonnées de process, décision active et indication claire de ce que JON attend maintenant.
- Le mode terminal par défaut est désormais gouverné par `agentConfiguration.guardrails.terminalWorkspaceView` et pilotable depuis la console admin.
- ActivityPanel : trace/run inspector secondaire avec surfaces terminales, alertes, décisions, transcript, mission brief, browser strategy.
- Streaming de réponse avec curseur, UiBlocks (table, chart, metrics, artifacts, evidence).

### 11.3 Tests

- `workspace-terminal-orchestration` : persistance, détection, policy, processus réel stdin/stdout, input approuvé, completion.
- `cli-terminal-supervisor` : allowlist, spawn, output, input, exit.

## 12. Partiellement implémenté

- La supervision terminal peut lancer et suivre des processus CLI pipe-based, mais pas encore un vrai PTY interactif complet. La sortie ANSI est strippée côté superviseur (`stripAnsi`) et le terminal reçoit `NO_COLOR=1 TERM=dumb` pour minimiser le bruit.
- L'attachement de terminaux externes (déjà ouverts par l'utilisateur) passe par `POST /api/projects/:id/workspace/terminals` avec `status`, `recentOutput`, et `processRunning` dans le payload. Le backend détecte l'état heuristiquement. L'utilisateur doit ensuite patcher l'état via `PATCH /api/projects/:id/workspace/terminals/:id` au fil des changements. Il n'y a pas encore de PTY bidirectionnel pour des terminaux ouverts hors de JON.
- Le suivi de mission globale est structuré (mission brief) et mis à jour automatiquement à chaque transition terminale significative (`#updateMissionBriefFromTerminalEvent`) : blockers, progress et next steps sont recalculés heuristiquement. L'évaluation LLM continue (lecture réelle de l'avancement) reste différée.
- Le bridge terminal → conversation injecte dans la conversation la plus récente du projet ; si aucune conversation n'existe, seul l'événement SSE est émis.

## 13. Finalisé depuis v1

- **Stripping ANSI** : sortie terminal nettoyée avant persistance et alertes.
- **Mission brief auto-update** : blockers, progress et next steps mis à jour automatiquement sur chaque transition terminale significative.
- **Bouton "Injecter contexte"** : exposé dans `TerminalAlertMessage` quand `autonomyMode === "supervised_autonomy"` et `decisionAction === "auto_inject_context"`. Envoie l'objectif de mission dans le terminal avec `approved: true`.
- **Restauration des alertes terminal depuis l'historique** : `conversationTurnsToMessages` reconnaît désormais `kind: "terminal_alert"` et reconstruit le composant à partir des turns backend au rechargement de page.
- **`missionObjective` et `autonomyMode` dans les payloads SSE** : l'alerte SSE et le turn DB embarquent ces champs pour permettre l'inject context côté UI.

## 14. Différé

- Attachement PTY temps réel robuste (vrai terminal interactif bidirectionnel).
- Détection automatique de terminaux externes déjà ouverts par l'utilisateur.
- Évaluation LLM continue de l'avancement global par rapport au cahier des charges.
- Handoff multi-agent long avec reprise automatique complète.
- Packaging / signing production.
- Mise à jour automatique du mission brief quand un run se termine.
