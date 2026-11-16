import type { Conn } from "@/db";
import { keywords, settings } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/lib/domain/settings";
import { getRawSetting, setSetting } from "./services/settings";
import { ensureDefaultTemplates } from "./services/templates";

// Données de départ, appliquées une seule fois par version (réglage `seedVersion`).
// Une future étape qui a besoin de nouvelles données incrémente SEED_VERSION et ajoute un bloc.
export const SEED_VERSION = 3;

const STARTER_KEYWORDS: { label: string; category: string; aliases?: string[] }[] = [
  { label: "Python", category: "Langages" },
  { label: "C++", category: "Langages", aliases: ["cpp"] },
  { label: "Java", category: "Langages" },
  { label: "R", category: "Langages" },
  { label: "SQL", category: "Langages" },
  { label: "Scala", category: "Langages" },
  { label: "Machine Learning", category: "ML / DL", aliases: ["ML", "apprentissage automatique"] },
  { label: "Deep Learning", category: "ML / DL", aliases: ["apprentissage profond"] },
  { label: "PyTorch", category: "ML / DL", aliases: ["torch"] },
  { label: "TensorFlow", category: "ML / DL" },
  { label: "Keras", category: "ML / DL" },
  { label: "JAX", category: "ML / DL" },
  { label: "scikit-learn", category: "ML / DL", aliases: ["sklearn", "scikit learn"] },
  { label: "XGBoost", category: "ML / DL" },
  { label: "Reinforcement Learning", category: "ML / DL", aliases: ["apprentissage par renforcement", "RL"] },
  { label: "NLP", category: "NLP / LLM", aliases: ["natural language processing", "traitement automatique du langage", "traitement du langage naturel", "TALN"] },
  { label: "LLM", category: "NLP / LLM", aliases: ["LLMs", "large language model", "large language models", "grands modèles de langage"] },
  { label: "Transformers", category: "NLP / LLM" },
  { label: "Hugging Face", category: "NLP / LLM", aliases: ["HuggingFace"] },
  { label: "RAG", category: "NLP / LLM", aliases: ["retrieval-augmented generation", "retrieval augmented generation"] },
  { label: "LangChain", category: "NLP / LLM" },
  { label: "Fine-tuning", category: "NLP / LLM", aliases: ["fine tuning", "finetuning"] },
  { label: "IA générative", category: "NLP / LLM", aliases: ["generative AI", "GenAI", "IA gen"] },
  { label: "Prompt engineering", category: "NLP / LLM" },
  { label: "Computer Vision", category: "Vision", aliases: ["vision par ordinateur"] },
  { label: "OpenCV", category: "Vision" },
  { label: "Détection d'objets", category: "Vision", aliases: ["object detection"] },
  { label: "Segmentation", category: "Vision" },
  { label: "pandas", category: "Data" },
  { label: "NumPy", category: "Data" },
  { label: "Spark", category: "Data", aliases: ["PySpark", "Apache Spark"] },
  { label: "Statistiques", category: "Data", aliases: ["statistics", "statistique"] },
  { label: "Séries temporelles", category: "Data", aliases: ["time series"] },
  { label: "Databricks", category: "Data" },
  { label: "MLOps", category: "MLOps / Cloud" },
  { label: "MLflow", category: "MLOps / Cloud" },
  { label: "Airflow", category: "MLOps / Cloud" },
  { label: "Docker", category: "MLOps / Cloud" },
  { label: "Kubernetes", category: "MLOps / Cloud", aliases: ["k8s"] },
  { label: "CI/CD", category: "MLOps / Cloud" },
  { label: "FastAPI", category: "MLOps / Cloud" },
  { label: "AWS", category: "MLOps / Cloud" },
  { label: "GCP", category: "MLOps / Cloud", aliases: ["Google Cloud"] },
  { label: "Azure", category: "MLOps / Cloud" },
  { label: "Git", category: "Outils" },
  { label: "Linux", category: "Outils" },
];

/** Applique les données de départ manquantes. Renvoie un résumé lisible de ce qui a été fait. */
export function seedIfNeeded(conn: Conn, now = new Date()): string[] {
  const version = getRawSetting<number>(conn, "seedVersion") ?? 0;
  if (version >= SEED_VERSION) return [];
  const log: string[] = [];

  conn.transaction((tx) => {
    if (version < 1) {
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        tx.insert(settings).values({ key, value }).onConflictDoNothing().run();
      }
      for (const k of STARTER_KEYWORDS) {
        tx.insert(keywords)
          .values({ label: k.label, category: k.category, aliases: k.aliases ?? [] })
          .onConflictDoNothing()
          .run();
      }
      log.push(`${STARTER_KEYWORDS.length} mots-clés de départ`);
    }
    if (version < 3) {
      // v2 : gabarits de prompts et de messages ; v3 : prompt « Recherche d'entreprises ».
      const added = ensureDefaultTemplates(tx, now);
      if (added) log.push(`${added} gabarit(s) de prompts et de messages`);
    }
    setSetting(tx, "seedVersion", SEED_VERSION);
  });
  return log;
}
