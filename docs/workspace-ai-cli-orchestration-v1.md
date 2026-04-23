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

Ce lot doit livrer une première fondation réelle :

- modèle persistant de sessions terminal attachées,
- détection heuristique d'état terminal,
- classification minimale Codex CLI / Claude Code CLI / generic CLI,
- journal de décisions d'orchestration,
- mission brief workspace persistant,
- API workspace,
- affichage dans l'inspecteur de session,
- tests de persistance, détection, policy de décision et affichage minimal.

## 12. Partiellement implémenté maintenant

- La supervision terminal est fondée sur télémétrie attachée et sortie récente, pas encore sur PTY natif complet.
- L'injection automatique de contexte est décidée et journalisée comme recommandation, mais n'écrit pas encore dans un terminal réel.
- Le suivi de mission globale est structuré, mais pas encore alimenté par un évaluateur LLM continu.

## 13. Différé

- Attachement PTY temps réel robuste.
- Lecture/écriture contrôlée dans les terminaux Codex CLI / Claude Code CLI.
- Évaluation LLM continue de l'avancement global.
- Handoff multi-agent long avec reprise automatique complète.
- Packaging/signing production.
- Validation utilisateur longue sur missions multi-terminal.
