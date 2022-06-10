import { NextFunction, Request, Response } from 'express';

export const wrap = (handler: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await handler(req, res);
    res.status(200).send(response);
  } catch (e) {
    next(e);
  }
};

export type Handler = (req: Request, res: Response) => any;
