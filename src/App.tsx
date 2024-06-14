import { useCallback, useState } from "react";
import { useDaily, useDailyEvent } from "@daily-co/daily-react";
import { ArrowRight, Loader2 } from "lucide-react";

import { Alert } from "./components/alert";
import { Button } from "./components/button";
import { DeviceSelect } from "./components/DeviceSelect";
import { RoomInput } from "./components/RoomInput";
import Session from "./components/Session";
import { SettingList } from "./components/SettingList/SettingList";
import { Switch } from "./components/switch";
import { fetch_meeting_token, fetch_start_agent } from "./actions";

type State =
  | "idle"
  | "configuring"
  | "requesting_agent"
  | "requesting_token"
  | "connecting"
  | "connected"
  | "started"
  | "finished"
  | "error";

const status_text = {
  configuring: "Let's go!",
  requesting_agent: "Requesting agent...",
  requesting_token: "Requesting token...",
  connecting: "Connecting to room...",
};

// Server URL (ensure trailing slash)
let serverUrl = import.meta.env.VITE_SERVER_URL || import.meta.env.BASE_URL;
if (!serverUrl.endsWith("/")) serverUrl += "/";

// Query string for room URL
const roomQs = new URLSearchParams(window.location.search).get("room_url");
const checkRoomUrl = (url: string | null): boolean =>
  !!(url && /^(https?:\/\/[^.]+(\.staging)?\.daily\.co\/[^/]+)$/.test(url));
const autoRoomCreation = import.meta.env.VITE_MANUAL_ROOM_ENTRY ? false : true;

// Mic mode
const isOpenMic = import.meta.env.VITE_OPEN_MIC ? true : false;

export default function App() {
  const daily = useDaily();

  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startAudioOff, setStartAudioOff] = useState<boolean>(false);
  const [roomUrl, setRoomUrl] = useState<string | null>(roomQs || null);
  const [roomError, setRoomError] = useState<boolean>(
    (roomQs && checkRoomUrl(roomQs)) || false
  );

  let userStoppedSpeakingTime = 0.0;

  function handleRoomUrl() {
    if (checkRoomUrl(roomUrl) || autoRoomCreation) {
      setRoomError(false);
      setState("configuring");
    } else {
      setRoomError(true);
    }
  }

  async function start() {
    if (!daily || (!roomUrl && !autoRoomCreation)) return;

    let data;

    // Request agent to start, or join room directly
    if (import.meta.env.VITE_SERVER_URL) {
      // Request a new agent to join the room
      setState("requesting_agent");

      try {
        data = await fetch_start_agent(roomUrl, serverUrl);

        if (data.error) {
          setError(data.detail);
          setState("error");
          return;
        }
      } catch (e) {
        setError(
          `Unable to connect to the server at '${serverUrl}' - is it running?`
        );
        setState("error");
        return;
      }
    } else {
      // Retrieve user token for room
      setState("requesting_token");

      try {
        data = await fetch_meeting_token(roomUrl);
      } catch (e) {
        setError(
          `Unable to get token for room: ${roomUrl} - have you set your Daily API key?`
        );
        setState("error");
        return;
      }
    }

    // Join the daily session, passing through the url and token
    setState("connecting");

    await daily.join({
      url: data.room_url || roomUrl,
      token: data.token,
      videoSource: false,
      startAudioOff: startAudioOff,
    });

    // Away we go...
    setState("connected");
  }

  async function leave() {
    await daily?.leave();
    setState("idle");
  }

  function currentTime() {
    return Date.now() / 1000;
  }

  function handleVAD(type, track) {
      const audioContext = new AudioContext();

      const stream = new MediaStream([track]);
      const source = audioContext.createMediaStreamSource(stream);

      const bufferSize = 1024; // For 44100 this would be like 10ms
      const scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      const speechThreshold = 0.03;
      const smoothingFactor = 0.2;
      const vadStartSecs = 0.2;
      const vadStopSecs = 0.8;

      let prevRMS = 0;
      let prevState = 'silence';
      let lastTimeSpeaking = 0;
      let lastTimeSilence = currentTime();

      // TODO(aleix): We need to stop this when the meeting ends.
      scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const inputData = inputBuffer.getChannelData(0); // Assuming mono audio
        let sum = 0;

        // Compute the sum of squares of the samples
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }

        const rms = Math.sqrt(sum / inputData.length);
        const smoothedRMS = prevRMS + smoothingFactor * (rms - prevRMS);

        let speaking = smoothedRMS >= speechThreshold;

       const currTime = currentTime();
        if (speaking) {
          if (prevState === 'silence') {
            const speakingTime = currTime - lastTimeSilence;
            if (speakingTime >= vadStartSecs) {
              console.log(`${type} STARTED SPEAKING`, currTime);
              prevState = 'speaking';
              if (type === 'remote' && userStoppedSpeakingTime > 0.0) {
                const timing = currTime - userStoppedSpeakingTime - vadStartSecs;
                console.log(`TIMING BETWEEN USER AND BOT ${timing}`);
              }
            }
          }
          lastTimeSpeaking = currTime;
        } else {
          if (prevState === 'speaking') {
            const silenceTime = currTime - lastTimeSpeaking;
            if (silenceTime >= vadStopSecs) {
                console.log(`${type} STOPPED SPEAKING`, currTime);
                prevState = 'silence';
                if (type === 'local') {
                  userStoppedSpeakingTime = currTime - vadStopSecs;
                }
            }
          }
          lastTimeSilence = currTime;
        }

        prevRMS = smoothedRMS;
      }
  }
  useDailyEvent(
    'track-started',
    useCallback((ev) => {
      if (ev.participant?.local) {
        handleVAD('local', ev.track);
      } else {
        handleVAD('remote', ev.track);
      }
    }, [])
  );

  if (state === "error") {
    return (
      <Alert intent="danger" title="An error occurred">
        {error}
      </Alert>
    );
  }

  if (state === "connected") {
    return (
      <Session
        onLeave={() => leave()}
        openMic={isOpenMic}
        startAudioOff={startAudioOff}
      />
    );
  }

  if (state !== "idle") {
    return (
      <div className="card card-appear">
        <div className="card-inner card-md">
          <div className="card-header">
            <h1>Configure your devices</h1>
            <p> Please configure your microphone and speakers below</p>
          </div>
          <DeviceSelect />
          <div className="config-options">
            <div className="config-option">
              <label>Join with mic muted:</label>
              <Switch
                checked={startAudioOff}
                onCheckedChange={() => setStartAudioOff(!startAudioOff)}
              />
            </div>
          </div>
          <div className="card-footer">
            <Button
              key="start"
              onClick={() => start()}
              disabled={state !== "configuring"}
            >
              {state !== "configuring" && <Loader2 className="animate-spin" />}
              {status_text[state as keyof typeof status_text]}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card card-appear">
      <div className="card-inner card-md">
        <div className="card-header">
          <h1>Pipecat {import.meta.env.VITE_APP_TITLE}</h1>
          <p>Check configuration below</p>
        </div>

        {import.meta.env.DEV &&
          !import.meta.env.VITE_SERVER_URL &&
          !import.meta.env.VITE_DAILY_API_KEY && (
            <Alert title="Missing server URL environment" intent="danger">
              <p>
                You have not set a server URL for local development, or a Daily
                API Key if you're bypassing starting an agent. Please set{" "}
                <samp>VITE_SERVER_URL</samp> in <samp>.env.local</samp>.
              </p>
              <p>
                Without this, the client will attempt to start the bot by
                calling localhost on the same port.
              </p>
            </Alert>
          )}
        <SettingList
          serverUrl={serverUrl}
          roomQueryString={roomQs}
          roomQueryStringValid={checkRoomUrl(roomQs)}
        />

        {import.meta.env.VITE_MANUAL_ROOM_ENTRY && !roomQs && (
          <RoomInput onChange={(url) => setRoomUrl(url)} error={roomError} />
        )}
        <div className="card-footer">
          <Button
            key="next"
            disabled={!!(roomQs && !roomError)}
            onClick={() => handleRoomUrl()}
          >
            Next <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
