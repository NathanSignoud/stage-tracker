import { CompaniesView } from "@/components/companies/companies-view";
import { ImportCompaniesDialog } from "@/components/companies/import-companies-dialog";
import { PageHeader } from "@/components/page-header";
import { getDb } from "@/db";
import { listCompanies } from "@/server/services/companies";

export const metadata = { title: "Entreprises" };

export default async function CompaniesPage({ searchParams }: PageProps<"/entreprises">) {
  const { q } = await searchParams;
  const companies = listCompanies(getDb());
  const withApplication = companies.filter((c) => c.applications.length).length;
  const toExplore = companies.filter((c) => !c.applications.length && c.status === "to_explore").length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Entreprises"
        description={`Ta liste d'entreprises cibles · ${toExplore} à explorer · ${withApplication} avec candidature`}
        actions={<ImportCompaniesDialog existingNames={companies.map((c) => c.name)} />}
      />
      <CompaniesView key={typeof q === "string" ? q : ""} companies={companies} initialQuery={typeof q === "string" ? q : ""} />
    </div>
  );
}
