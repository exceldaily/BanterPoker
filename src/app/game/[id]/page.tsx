"use client";

import { use } from "react";
import { GameScreen } from "@/components/game/GameScreen";

export default function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <GameScreen key={id} id={id} />;
}
