# Missing information before build

## But du document

Lister ce qui manque encore avant la suite du projet, maintenant que l'autorisation du prototype étroit est possible.

Le but n'est plus d'identifier des blocages avant prototype. Le but est de séparer ce qui reste ouvert :

- après prototype ;
- avant MVP ;
- avant production.

## Méthode de lecture

- `Non bloquant avant prototype` : le build prototype peut commencer sans cette information.
- `Bloque avant MVP` : la première itération peut démarrer, mais pas un MVP crédible.
- `Bloque avant production` : important plus tard, pas décisif pour le prototype.

## 1. Décisions produit encore ouvertes

### Verticale prioritaire réellement choisie

- Pourquoi c'est important : elle conditionnera l'après-prototype et le vrai produit.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

### Portefeuille d'artefacts au-delà de la `Note de decision`

- Pourquoi c'est important : le prototype a volontairement fermé le set minimum ; le MVP devra aller plus loin.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

## 2. Décisions runtime encore ouvertes

### Split final runtime / shell / langage

- Pourquoi c'est important : impacte l'architecture de moyen terme.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

### Contrat détaillé des payloads d'événements

- Pourquoi c'est important : utile pour cohérence UI, audit et reprise.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

## 3. Décisions browser control encore ouvertes

### Stratégie d'entrée sur surfaces authentifiées réelles

- Pourquoi c'est important : pivot majeur de risque et de complexité.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP élargi

### Fallback visuel au-delà du slice DOM-first

- Pourquoi c'est important : il faudra définir sa vraie place sans en faire une béquille.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

### Registre canonique des domaines et policies par surface

- Pourquoi c'est important : nécessaire pour sortir des surfaces contrôlées proprement.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

## 4. Décisions sécurité encore ouvertes

### Politique de redaction avancée des preuves

- Pourquoi c'est important : la minimisation est fermée, mais la redaction fine reste à détailler.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

### Stratégie technique des secrets et sessions sensibles

- Pourquoi c'est important : indispensable avant vraies surfaces authentifiées.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP authentifié

## 5. Décisions persistance encore ouvertes

### Représentation technique exacte du stockage local

- Pourquoi c'est important : le modèle conceptuel est fermé, la forme technique reste libre.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

### Politique de retention configurable

- Pourquoi c'est important : utile pour contrôle, conformité et usage réel.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

## 6. Décisions UX opérateur encore ouvertes

### Contrat de timeline opérateur

- Pourquoi c'est important : il manque encore le niveau exact d'information de la timeline.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

### Contrat d'édition d'artefact plus riche

- Pourquoi c'est important : le prototype n'a besoin que de revue et export, pas d'édition avancée.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

## 7. Décisions benchmarks encore ouvertes

### Gouvernance du corpus de fixtures et benchmarks

- Pourquoi c'est important : nécessaire pour éviter la dérive des benchmarks dans le temps.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

### Stratégie de comparaison inter-runs plus fine

- Pourquoi c'est important : utile pour mesurer une progression stable.
- Statut : `Non bloquant avant prototype`
- Bloque : avant MVP

## 8. Ce qui ne manque plus de manière bloquante

Ces points sont désormais fermés avant prototype :

- le slice exact du prototype ;
- la persistance locale minimale ;
- le contrat UX d'approval ;
- les artefacts prototype ;
- le protocole de revue benchmark ;
- la gate navigateur.

## Conclusion

Il ne reste plus de manque strictement bloquant avant le prochain run de développement prototype.

Les informations encore absentes concernent surtout l'élargissement vers MVP puis production.
