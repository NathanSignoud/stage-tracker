import { UserPlus } from "lucide-react";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";
import { ContactsTable } from "@/components/contacts/contacts-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { listContacts } from "@/server/services/contacts";

export const metadata = { title: "Contacts" };

export default function ContactsPage() {
  const contacts = listContacts(getDb());
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Contacts"
        description={`${contacts.length} personne${contacts.length > 1 ? "s" : ""}`}
        actions={
          <ContactFormDialog
            openAfterCreate
            trigger={
              <Button variant="outline" size="sm">
                <UserPlus /> Nouveau contact
              </Button>
            }
          />
        }
      />
      <ContactsTable contacts={contacts} />
    </div>
  );
}
