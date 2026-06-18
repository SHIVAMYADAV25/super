"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { EmailDetail } from "@/src/components/Email/EmailDetail";
import { ComposeModal } from "@/src/components/compose/compose-modal";
import { api } from "@/src/lib/api-client";

import type { Email } from "@/src/types";

export default function EmailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const id = params.id as string;

  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Email | null>(null);

  const archiveMutation = useMutation({
    mutationFn: (gmailId: string) =>
      api.post(`/api/emails/${gmailId}/archive`, {}),

    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["emails"],
      });

      router.push("/inbox");
    },
  });

  const handleClose = () => {
    router.push("/inbox");
  };

  const handleArchive = (gmailId: string) => {
    archiveMutation.mutate(gmailId);
  };

  const handleReply = (email: Email) => {
    setReplyTo(email);
    setComposeOpen(true);
  };

  return (
    <>
      <div className="w-full h-screen overflow-hidden">
        <EmailDetail
          gmailId={id}
          onClose={handleClose}
          onReply={handleReply}
          onArchive={handleArchive}
        />
      </div>

      {composeOpen && (
        <ComposeModal
          replyTo={replyTo}
          onClose={() => {
            setComposeOpen(false);
            setReplyTo(null);
          }}
          onSent={() => {
            setComposeOpen(false);
            setReplyTo(null);

            void queryClient.invalidateQueries({
              queryKey: ["emails"],
            });
          }}
        />
      )}
    </>
  );
}