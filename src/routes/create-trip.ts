import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import dayjs from "dayjs";
import { getMailClient } from "../lib/mail";
import { logger } from "../lib/logger";
import nodemailer from "nodemailer";
import { ClientError } from "../errors/client-error";
import { env } from "../env";

export const createTrip = async (app: FastifyInstance) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/trips",
    {
      schema: {
        body: z.object({
          destination: z.string().min(4),
          starts_at: z.coerce.date(),
          ends_at: z.coerce.date(),
          owner_name: z.string(),
          owner_email: z.string().email(),
          emails_to_invite: z.array(z.string().email()),
        }),
      },
    },
    async (request) => {
      const {
        destination,
        starts_at,
        ends_at,
        owner_email,
        owner_name,
        emails_to_invite,
      } = request.body;

      if (dayjs(starts_at).isBefore(dayjs()))
        throw new ClientError("Invalid trip start date");

      if (dayjs(ends_at).isBefore(starts_at))
        throw new ClientError("Invalid trip end date");

      const trip = await prisma.trip.create({
        data: {
          destination,
          starts_at,
          ends_at,
          participants: {
            createMany: {
              data: [
                {
                  name: owner_name,
                  email: owner_email,
                  is_confirmed: true,
                  is_owner: true,
                },
                ...emails_to_invite.map((email) => ({
                  email,
                })),
              ],
            },
          },
        },
      });

      const formattedStartDate = dayjs(starts_at).format("LL");
      const formattedEndDate = dayjs(ends_at).format("LL");

      const confirmationLink = `${env.BASE_URL}/trips/${trip.id}/confirm`;

      const mail = await getMailClient();

      const message = await mail.sendMail({
        from: {
          name: "Equipe plann.er",
          address: "planner@nicolasalexandre.tech",
        },
        to: {
          name: owner_name,
          address: owner_email,
        },
        subject: `Confirme sua viagem para ${destination} em ${formattedStartDate}`,
        html: `
          <div style="font-family: sans-serif; font-size: 16px; line-height: 1.6;">
            <p>Você solicitou a criação de uma viagem para <strong>${destination}</strong> nas datas de <strong>${formattedStartDate}</strong> até <strong>${formattedEndDate}</strong></p>
            <p></p>
            <p>Para confirmar sua viagem, clique no link abaixo:</p>
            <p></p>
            <p><a href="${confirmationLink}">Confirmar viagem</a></p>
            <p></p>
            <!-- <p>Caso esteja usando um dispositivo móvel, você também pode confirmar a criação da viagem pelos aplicativos:</p>
            Aplicativo para Android
            Aplicativo para iPhone -->
            <p>Caso você não saiba do que se trata este e-mail, apenas o ignore.</p>
          </div>
        `.trim(),
      });

      logger.info(`email sent to: "${owner_email}" (${owner_name}) `, {
        test_url: nodemailer.getTestMessageUrl(message),
      });

      return { trip_id: trip.id };
    }
  );
};
