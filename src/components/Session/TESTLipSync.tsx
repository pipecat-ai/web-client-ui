import React, { useCallback } from "react";
import { useDailyEvent } from "@daily-co/daily-react";

import { LipSync } from "@/lipsync";

const TESTLipSync: React.FC = () => {
  useDailyEvent(
    "track-started",
    useCallback((ev) => {
      if (!ev.participant?.local) {
        const ls = new LipSync();
        ls.start(ev.track);
      }
    }, [])
  );

  return <></>;
};

export default TESTLipSync;
