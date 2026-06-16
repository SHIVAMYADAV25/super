"use client";

import { useParams, useRouter } from "next/navigation";
import { EmailDetail } from "@/src/components/Email/EmailDetail";

export default function EmailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  // Handler for when the user clicks 'Back' in your UI
  const handleClose = () => {
    router.push("/inbox"); 
  };

  // Basic handlers for the EmailDetail component props
  const handleReply = (email: any) => console.log("Reply to", email.id);
  const handleArchive = (gmailId: string) => console.log("Archive", gmailId);

  return (
    <div className="w-full h-screen overflow-hidden">
      <EmailDetail
        gmailId={id}
        onClose={handleClose}
        onReply={handleReply}
        onArchive={handleArchive}
      />
    </div>
  );
}